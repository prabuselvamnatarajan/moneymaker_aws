import Deployment from "../models/deployment.js";
import fs from "fs/promises";
import path from "path";
import Trade from "../models/trade.js";
import Ledger from "../models/ledger.js";
import Position from "../models/position.js";
import Account from "../models/account.js";
import UserSymbol from "../models/userSymbol.js";
import Strategy from "../models/strategy.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";
import { createClient } from "redis";
import { getSymbolCandles, publishSymbolUpdate } from "./symbol.js";
import {
  resolveOptionSymbol,
  computeReferenceStrike,
} from "./optionSymbolResolver.js";

const USER_UPDATABLE_FIELDS = ["deployment_name", "notes", "backtest_date", "backtest_speed", "use_full_amount"];

const hasOpenPosition = async (deploymentId) => {
  const openPos = await Position.findOne({
    deployment_id: deploymentId,
    status: "OPEN",
    open_size: { $ne: 0 },
  });
  if (openPos) return true;
  const dep = await Deployment.findById(deploymentId).select("position_size");
  return !!(dep && dep.position_size !== 0);
};

const subscribeSymbolToken = async (instrumentToken, userId) => {
  if (!instrumentToken) return;
  try {
    await publishSymbolUpdate({
      action: "subscribe",
      instrument_token: instrumentToken,
      userId,
    });
  } catch (err) {
    console.error("[Deployment Service] Failed to publish symbol subscription:", err.message);
  }
};

/**
 * Redis index for the symbol-control Kafka consumer.
 * Keys:
 *  - symbol_control:underlyings (SET of underlying instrument tokens)
 *  - symbol_control:deps:{token} (JSON array of controlled RUNNING deployments)
 */
export const syncControlledDeploymentsIndex = async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("⚠️ REDIS_URL not set, skipping symbol_control index sync");
    return;
  }

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();

    const controlled = await Deployment.find({
      current_status: "RUNNING",
      "symbol_control.enabled": true,
    }).lean();

    const byUnderlying = {};
    for (const dep of controlled) {
      const token = dep.symbol_control?.underlying_instrument_token;
      if (!token) continue;

      let strikeDiff = null;
      if (dep.symbol_control.underlying_user_symbol_id) {
        const underlying = await UserSymbol.findById(dep.symbol_control.underlying_user_symbol_id)
          .select("strike_price_diff")
          .lean();
        strikeDiff = underlying?.strike_price_diff ?? null;
      }

      if (!byUnderlying[token]) byUnderlying[token] = [];
      byUnderlying[token].push({
        deployment_id: dep._id.toString(),
        last_resolved_strike: dep.symbol_control.last_resolved_strike ?? null,
        strike_price_diff: strikeDiff,
        pending_resolve: !!dep.symbol_control.pending_resolve,
        strategy_mode: dep.strategy_mode,
      });
    }

    const existingKeys = await client.keys("symbol_control:deps:*");
    for (const key of existingKeys) {
      const token = key.replace("symbol_control:deps:", "");
      if (!byUnderlying[token]) {
        await client.del(key);
      }
    }

    await client.del("symbol_control:underlyings");
    const tokens = Object.keys(byUnderlying);
    if (tokens.length > 0) {
      await client.sAdd("symbol_control:underlyings", tokens);
    }

    for (const [token, deps] of Object.entries(byUnderlying)) {
      const key = `symbol_control:deps:${token}`;
      const payload = { deployments: deps };
      if (typeof client.json?.set === "function") {
        await client.json.set(key, ".", payload);
      } else {
        await client.set(key, JSON.stringify(payload));
      }
    }

    console.log(
      `[SymbolControl] Synced index for ${tokens.length} underlyings / ${controlled.length} deployments`
    );
  } catch (err) {
    console.error("[SymbolControl] Failed to sync controlled deployments index:", err.message);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
};

const applyResolvedOptionToDeployment = async (deployment, resolved, referenceStrike) => {
  const oldToken = deployment.instrument_token;
  deployment.user_symbol_id = resolved.user_symbol_id;
  deployment.instrument_token = resolved.instrument_token;
  deployment.symbol = resolved.symbol;
  deployment.symbol_control.last_resolved_strike =
    referenceStrike != null ? referenceStrike : resolved.atm_strike;
  deployment.symbol_control.last_resolved_at = new Date();
  deployment.symbol_control.pending_resolve = false;
  deployment.symbol_control.last_resolve_error = null;
  await deployment.save();

  if (oldToken && oldToken !== resolved.instrument_token) {
    await subscribeSymbolToken(resolved.instrument_token, deployment.user_id);
  }

  // syncAllDeploymentsToRedis also refreshes the symbol_control Redis index
  await syncAllDeploymentsToRedis();
  return deployment;
};

/**
 * Resolve (or re-resolve) the option symbol for a controlled deployment.
 * Honors the open-position gate: if open, sets pending_resolve and skips remap.
 */
export const resolveDeploymentSymbol = async (deploymentId, options = {}) => {
  const deployment = await Deployment.findById(deploymentId);
  if (!deployment) {
    throw new Error("Deployment not found");
  }
  if (!deployment.symbol_control?.enabled) {
    throw new Error("Deployment does not have symbol_control enabled");
  }

  const sc = deployment.symbol_control;
  const underlyingToken = sc.underlying_instrument_token;
  if (!underlyingToken) {
    throw new Error("symbol_control.underlying_instrument_token is missing");
  }

  const force = !!options.force;
  if (!force && (await hasOpenPosition(deployment._id))) {
    deployment.symbol_control.pending_resolve = true;
    if (options.reference_strike != null) {
      // Keep last_resolved_strike as-is; pending flag means grid moved while flat wait
    }
    await deployment.save();
    await syncControlledDeploymentsIndex();
    return {
      deferred: true,
      reason: "open_position",
      deployment,
    };
  }

  try {
    const resolved = await resolveOptionSymbol({
      userId: deployment.user_id.toString(),
      underlyingSymbol: underlyingToken,
      moneyness: sc.moneyness || "ITM",
      offset: sc.offset || 1,
      optionType: sc.option_type || "CE",
      expiry: sc.expiry || "current_week",
      ltp: options.ltp,
    });

    // Conflict check: another RUNNING/SCHEDULED deployment on same strategy+account+new token
    const conflict = await Deployment.findOne({
      _id: { $ne: deployment._id },
      strategy_id: deployment.strategy_id,
      account_id: deployment.account_id,
      instrument_token: resolved.instrument_token,
      current_status: { $in: ["RUNNING", "SCHEDULED"] },
    });
    if (conflict) {
      throw new Error(
        `Cannot remap: active deployment ${conflict._id} already uses ${resolved.instrument_token}`
      );
    }

    const underlying = await UserSymbol.findById(sc.underlying_user_symbol_id);
    const strikeDiff = underlying?.strike_price_diff;
    let referenceStrike = options.reference_strike;
    if (referenceStrike == null && strikeDiff && resolved.ltp) {
      referenceStrike = computeReferenceStrike(resolved.ltp, strikeDiff);
    }
    if (referenceStrike == null) {
      referenceStrike = resolved.atm_strike;
    }

    // No-op if already on this option and strike
    if (
      deployment.instrument_token === resolved.instrument_token &&
      deployment.symbol_control.last_resolved_strike === referenceStrike
    ) {
      deployment.symbol_control.pending_resolve = false;
      deployment.symbol_control.last_resolve_error = null;
      deployment.symbol_control.last_resolved_at = new Date();
      await deployment.save();
      await syncControlledDeploymentsIndex();
      return { deferred: false, unchanged: true, deployment };
    }

    await applyResolvedOptionToDeployment(deployment, resolved, referenceStrike);
    return { deferred: false, unchanged: false, deployment, resolved };
  } catch (err) {
    deployment.symbol_control.last_resolve_error = err.message;
    await deployment.save();
    throw err;
  }
};

/**
 * Called when a deployment position goes flat; flushes pending_resolve if set.
 */
export const flushPendingSymbolResolve = async (deploymentId) => {
  const deployment = await Deployment.findById(deploymentId);
  if (!deployment?.symbol_control?.enabled || !deployment.symbol_control.pending_resolve) {
    return null;
  }
  if (await hasOpenPosition(deploymentId)) {
    return null;
  }
  console.log(`[SymbolControl] Flushing pending resolve for deployment ${deploymentId}`);
  return resolveDeploymentSymbol(deploymentId, { force: false });
};

const prepareSymbolControlOnCreate = async (userId, deploymentData) => {
  const sc = deploymentData.symbol_control;
  if (!sc || !sc.enabled) {
    return deploymentData;
  }

  const underlyingId = sc.underlying_user_symbol_id;
  if (!underlyingId) {
    throw new Error("symbol_control.underlying_user_symbol_id is required when enabled");
  }
  if (!sc.moneyness || !sc.option_type) {
    throw new Error("symbol_control.moneyness and option_type are required when enabled");
  }

  const underlying = await UserSymbol.findOne({ _id: underlyingId, user_id: userId });
  if (!underlying) {
    throw new Error("Underlying symbol not found");
  }
  if (String(underlying.instrument_class || "").toUpperCase() !== "INDEX") {
    throw new Error("symbol_control underlying must be an INDEX UserSymbol");
  }
  if (!(Number(underlying.strike_price_diff) > 0)) {
    throw new Error("Underlying INDEX symbol must have strike_price_diff > 0");
  }

  if (!underlying.is_active) {
    underlying.is_active = true;
    await underlying.save();
  }
  await subscribeSymbolToken(underlying.instrument_token, userId);

  const resolved = await resolveOptionSymbol({
    userId,
    underlyingSymbol: underlying.instrument_token,
    moneyness: sc.moneyness,
    offset: sc.offset || 1,
    optionType: sc.option_type,
    expiry: sc.expiry || "current_week",
  });

  const referenceStrike = computeReferenceStrike(resolved.ltp, underlying.strike_price_diff);

  return {
    ...deploymentData,
    user_symbol_id: resolved.user_symbol_id,
    instrument_token: resolved.instrument_token,
    symbol: resolved.symbol,
    symbol_control: {
      enabled: true,
      underlying_user_symbol_id: underlying._id,
      underlying_instrument_token: underlying.instrument_token,
      moneyness: String(sc.moneyness).toUpperCase(),
      offset: sc.offset || 1,
      option_type: String(sc.option_type).toUpperCase(),
      expiry: sc.expiry || "current_week",
      last_resolved_strike: referenceStrike,
      last_resolved_at: new Date(),
      pending_resolve: false,
      last_resolve_error: null,
    },
  };
};

const triggerBacktestIfNeeded = async (deployment) => {
  if (deployment.strategy_mode === "BACKTEST" && deployment.current_status === "RUNNING") {
    const symbolName = deployment.symbol;
    const date = deployment.backtest_date || new Date().toISOString().slice(0, 10);
    const timeMs = (deployment.backtest_speed !== undefined && deployment.backtest_speed !== null) ? deployment.backtest_speed : 1000;
    
    const runId = Date.now().toString();
    deployment.backtest_run_id = runId;
    await deployment.save();
    
    const triggerUrl = `${process.env.BACKTEST_CLIENT_URL || "http://backtest-client"}/?symbolName=${encodeURIComponent(symbolName)}&date=${encodeURIComponent(date)}&time_ms=${timeMs}&deployment_id=${encodeURIComponent(deployment._id.toString())}&run_id=${runId}`;
    console.log(`[Backtest] Triggering backtest client with run_id ${runId}: ${triggerUrl}`);
    fetch(triggerUrl)
      .then(res => res.text())
      .then(body => console.log(`[Backtest] Trigger response: ${body}`))
      .catch(err => console.error(`[Backtest] Error triggering backtest: ${err.message}`));
  }
};

const resetBacktestDeployment = async (deployment) => {
  if (deployment.strategy_mode !== "BACKTEST") {
    return;
  }

  const deploymentId = deployment._id;
  const symbol = deployment.symbol;

  try {
    // 1. Delete trades, ledgers and positions in MongoDB for this deployment
    const deletedTrades = await Trade.deleteMany({ deployment_id: deploymentId });
    const deletedLedgers = await Ledger.deleteMany({ deployment_id: deploymentId });
    const deletedPositions = await Position.deleteMany({ deployment_id: deploymentId });
    console.log(`[Reset] Deleted ${deletedTrades.deletedCount} trades, ${deletedLedgers.deletedCount} ledgers, and ${deletedPositions.deletedCount} positions for deployment ${deploymentId}`);

    // Reset cached position state on deployment
    deployment.position_size = 0;
    deployment.average_entry_price = 0;
    await deployment.save();
    console.log(`[Reset] Reset deployment cached position fields to 0`);

    // 2. Reset account balance in MongoDB
    if (deployment.account_id) {
      const account = await Account.findById(deployment.account_id);
      if (account) {
        account.current_balance = account.initial_balance;
        await account.save();
        console.log(`[Reset] Reset account ${account._id} current_balance to initial_balance: ${account.initial_balance}`);

        // Sync to Redis
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
          let client;
          try {
            client = createClient({ url: redisUrl });
            await client.connect();
            const accountIdStr = account.account_id || account._id.toString();
            const balanceKey = `account_balance:${accountIdStr}`;
            const balanceData = { balance: account.initial_balance };
            if (typeof client.json?.set === 'function') {
              await client.json.set(balanceKey, '.', balanceData);
            } else {
              await client.set(balanceKey, JSON.stringify(balanceData));
            }
            await client.del(`liquidity_sweep:open:${accountIdStr}`);
            console.log(`[Reset] Synced account balance for ${accountIdStr} to Redis: ${account.initial_balance}`);
          } catch (err) {
            console.error(`[Reset] Error syncing account balance to Redis: ${err.message}`);
          } finally {
            if (client) {
              await client.disconnect();
            }
          }
        }
      }
    }

    // 3. Clear Redis keys for strategy state and bought quantity
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      let client;
      try {
        client = createClient({ url: redisUrl });
        await client.connect();

        const deploymentIdStr = deploymentId.toString();

        // Safe non-blocking SCAN loop to delete all keys containing the deployment ID
        let cursor = 0;
        const pattern = `*${deploymentIdStr}*`;
        do {
          const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
          cursor = reply.cursor;
          const keys = reply.keys;
          if (keys && keys.length > 0) {
            await client.del(keys);
            console.log(`[Reset] Deleted scanned keys for deployment ${deploymentIdStr}:`, keys);
          }
        } while (cursor !== 0);
      } catch (err) {
        console.error(`[Reset] Error clearing Redis keys: ${err.message}`);
      } finally {
        if (client) {
          await client.disconnect();
        }
      }
    }
  } catch (err) {
    console.error(`[Reset] Error during backtest deployment reset: ${err.message}`);
  }
};

const LIQUIDITY_SWEEP_STRATEGY = "liquidity_sweep";

const resetLiquiditySweepRuntimeState = async (deployment) => {
  let strategyName = deployment.strategy_id?.strategy_name;
  if (!strategyName && deployment.strategy_id) {
    const strategy = await Strategy.findById(deployment.strategy_id);
    strategyName = strategy?.strategy_name;
  }
  if (strategyName !== LIQUIDITY_SWEEP_STRATEGY) {
    return;
  }

  const deploymentIdStr = deployment._id.toString();
  const symbol = deployment.symbol;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return;
  }

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();

    for (const mode of ["backtest", "live"]) {
      const stateKey = `strategies:${LIQUIDITY_SWEEP_STRATEGY}:${mode}:${deploymentIdStr}:${symbol}`;
      let state = null;
      try {
        if (typeof client.json?.get === "function") {
          state = await client.json.get(stateKey);
        } else {
          const raw = await client.get(stateKey);
          state = raw ? JSON.parse(raw) : null;
        }
      } catch (err) {
        console.warn(`[Reset] Could not read strategy state ${stateKey}: ${err.message}`);
      }

      if (state?.machineState === "IN_POSITION" && deployment.account_id) {
        const account = await Account.findById(deployment.account_id);
        const accountIdStr = account?.account_id || account?._id?.toString();
        if (accountIdStr) {
          const openKey = `liquidity_sweep:open:${accountIdStr}`;
          const val = await client.decr(openKey);
          if (val < 0) {
            await client.set(openKey, "0");
          }
          console.log(`[Reset] Decremented liquidity_sweep open counter for account ${accountIdStr}`);
        }
      }

      await client.del(stateKey);
    }

    let cursor = 0;
    const pattern = `*${deploymentIdStr}*`;
    do {
      const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = reply.cursor;
      const keys = reply.keys;
      if (keys && keys.length > 0) {
        await client.del(keys);
        console.log(`[Reset] Deleted runtime keys for deployment ${deploymentIdStr}:`, keys);
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error(`[Reset] Error resetting liquidity_sweep runtime state: ${err.message}`);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
};

export const createDeployment = async (userId, deploymentData) => {
  const prepared = await prepareSymbolControlOnCreate(userId, deploymentData);

  if (prepared.user_symbol_id) {
    const symbol = await UserSymbol.findOne({
      _id: prepared.user_symbol_id,
      user_id: userId,
    });
    if (!symbol) {
      throw new Error("Associated symbol not found");
    }
    if (!symbol.is_active) {
      throw new Error("Cannot associate an inactive symbol to deployment");
    }
  } else {
    throw new Error("user_symbol_id is required (or enable symbol_control to auto-resolve)");
  }

  const deployment = new Deployment({ ...prepared, user_id: userId });
  const result = await deployment.save();
  await resetBacktestDeployment(result);
  await triggerBacktestIfNeeded(result);
  await syncAllDeploymentsToRedis();
  await syncControlledDeploymentsIndex();
  return result;
};

export const getAllDeployments = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "start_time",
    dateField: "start_time",
    searchFields: ["symbol", "deployment_name"],
  });

  filter.user_id = userId;

  if (queryParams.current_status) {
    filter.current_status = queryParams.current_status.toUpperCase();
  }

  const items = await Deployment.find(filter).sort(sort).skip(skip).limit(limit);

  const total = await Deployment.countDocuments(filter);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

export const getDeploymentById = async (userId, id) => {
  return await Deployment.findOne({ _id: id, user_id: userId }).populate("strategy_id");
};

export const updateDeployment = async (userId, id, updateData) => {
  const sanitizedUpdate = pickAllowedFields(updateData, USER_UPDATABLE_FIELDS);

  if (Object.keys(sanitizedUpdate).length === 0) {
    throw new Error("No valid fields provided for update");
  }

  return await Deployment.findOneAndUpdate(
    { _id: id, user_id: userId },
    sanitizedUpdate,
    {
      new: true,
      runValidators: true,
    }
  );
};

export const deleteDeployment = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  // Cascade delete all child records: positions, trades, ledgers (all linked via deployment_id)
  const deletedPositions = await Position.deleteMany({ deployment_id: deployment._id, user_id: userId });
  const deletedTrades    = await Trade.deleteMany({ deployment_id: deployment._id, user_id: userId });
  const deletedLedger    = await Ledger.deleteMany({ deployment_id: deployment._id, user_id: userId });

  await Deployment.deleteOne({ _id: deployment._id });

  console.log(`[Deployment Service] Cascading delete complete for deployment ${deployment.deployment_name || deployment._id}: removed ${deletedTrades.deletedCount} trades, ${deletedPositions.deletedCount} positions, ${deletedLedger.deletedCount} ledger entries.`);

  await syncAllDeploymentsToRedis();
  await syncControlledDeploymentsIndex();
  return deployment;
};

// --- Lifecycle Actions ---

const VALID_TRANSITIONS = {
  start: { from: ["SCHEDULED", "STOPPED", "COMPLETED"], to: "RUNNING" },
  stop: { from: ["RUNNING", "PAUSED"], to: "STOPPED" },
  pause: { from: ["RUNNING"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "RUNNING" },
  restart: { from: ["RUNNING", "PAUSED", "STOPPED", "COMPLETED"], to: "RUNNING" },
};

export const transitionDeployment = async (userId, id, action) => {
  const transition = VALID_TRANSITIONS[action];
  if (!transition) {
    throw new Error(`Invalid action: ${action}`);
  }

  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) {
    return null;
  }

  if (!transition.from.includes(deployment.current_status)) {
    throw new Error(
      `Cannot ${action} deployment in status '${deployment.current_status}'. Allowed from: ${transition.from.join(", ")}`
    );
  }

  deployment.current_status = transition.to;

  if (action === "start" || action === "restart") {
    deployment.start_time = new Date();
    deployment.end_time = null;
    await resetBacktestDeployment(deployment);
    if (deployment.strategy_mode !== "BACKTEST") {
      await resetLiquiditySweepRuntimeState(deployment);
    }
  }
  if (action === "stop") {
    deployment.end_time = new Date();
  }

  // Auto-activate associated symbol and publish subscription update if transitioning to RUNNING (LIVE/PAPER)
  if ((action === "start" || action === "restart" || action === "resume") && deployment.strategy_mode !== "BACKTEST") {
    if (deployment.user_symbol_id) {
      const symbolObj = await UserSymbol.findOne({ _id: deployment.user_symbol_id, user_id: userId });
      if (symbolObj) {
        if (!symbolObj.is_active) {
          symbolObj.is_active = true;
          await symbolObj.save();
          console.log(`[Deployment Service] Auto-activated symbol ${symbolObj.symbol} for running deployment ${deployment._id}`);
        }
        await subscribeSymbolToken(symbolObj.instrument_token, userId);
      }
    }

    // Subscribe underlying for controlled deployments so LTP ticks reach the resolver
    if (deployment.symbol_control?.enabled && deployment.symbol_control.underlying_user_symbol_id) {
      const underlying = await UserSymbol.findOne({
        _id: deployment.symbol_control.underlying_user_symbol_id,
        user_id: userId,
      });
      if (underlying) {
        if (!underlying.is_active) {
          underlying.is_active = true;
          await underlying.save();
        }
        await subscribeSymbolToken(underlying.instrument_token, userId);
      }
    }
  }

  // Re-resolve option on start/resume for controlled deployments (if flat)
  if (
    (action === "start" || action === "restart" || action === "resume") &&
    deployment.symbol_control?.enabled
  ) {
    await deployment.save();
    try {
      await resolveDeploymentSymbol(deployment._id, { force: false });
      const refreshed = await Deployment.findById(deployment._id);
      if (refreshed) {
        Object.assign(deployment, refreshed.toObject());
      }
    } catch (err) {
      console.error(`[SymbolControl] Resolve on ${action} failed:`, err.message);
      deployment.symbol_control.last_resolve_error = err.message;
    }
  }

  await deployment.save();
  await triggerBacktestIfNeeded(deployment);
  await syncAllDeploymentsToRedis();
  await syncControlledDeploymentsIndex();
  return deployment;
};

// --- Monitoring ---

export const getDeploymentStatus = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;
  return {
    _id: deployment._id,
    current_status: deployment.current_status,
    start_time: deployment.start_time,
    end_time: deployment.end_time,
    symbol: deployment.symbol,
  };
};

export const getDeploymentLogs = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;
  return deployment.logs || [];
};

export const getDeploymentMetrics = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  const Trade = (await import("../models/trade.js")).default;
  const trades = await Trade.find({ deployment_id: deployment._id }).sort({ created_at: 1 });

  const totalTrades = trades.length;
  let totalPnL = 0;
  let wins = 0;
  let losses = 0;

  let positionSize = 0;
  let averageEntryPrice = 0;

  for (const trade of trades) {
    const qty = trade.quantity || 0;
    const price = trade.price || 0;
    const isBuy = trade.type_of_order === "BUY";
    const commission = trade.commission || 0;
    let pnl = 0;

    if (isBuy) {
      if (positionSize >= 0) {
        const newSize = positionSize + qty;
        averageEntryPrice = newSize > 0 ? (averageEntryPrice * positionSize + price * qty + commission) / newSize : 0;
        positionSize = newSize;
      } else {
        const coveredQty = Math.min(Math.abs(positionSize), qty);
        pnl = (averageEntryPrice - price) * coveredQty - commission;
        const remainingQty = qty - coveredQty;
        positionSize += coveredQty;
        if (remainingQty > 0) {
          positionSize = remainingQty;
          averageEntryPrice = price;
        } else if (positionSize === 0) {
          averageEntryPrice = 0;
        }
      }
    } else {
      if (positionSize <= 0) {
        const newSize = positionSize - qty;
        const absNewSize = Math.abs(newSize);
        averageEntryPrice = absNewSize > 0 ? (averageEntryPrice * Math.abs(positionSize) + price * qty + commission) / absNewSize : 0;
        positionSize = newSize;
      } else {
        const exitedQty = Math.min(positionSize, qty);
        pnl = (price - averageEntryPrice) * exitedQty - commission;
        const remainingQty = qty - exitedQty;
        positionSize -= exitedQty;
        if (remainingQty > 0) {
          positionSize = -remainingQty;
          averageEntryPrice = price;
        } else if (positionSize === 0) {
          averageEntryPrice = 0;
        }
      }
    }

    if (pnl !== 0) {
      totalPnL += pnl;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
    }
  }

  return {
    deployment_id: deployment._id,
    current_status: deployment.current_status,
    total_trades: totalTrades,
    total_pnl: parseFloat(totalPnL.toFixed(2)),
    wins,
    losses,
    win_rate: (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(2) + "%" : "0.00%",
  };
};

const parseDateTime = (dateStr, timeStr, defaultTime) => {
  if (!dateStr) return null;
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
  const time = timeStr || defaultTime;
  let fullStr = `${dateStr}T${time}`;
  if (time.split(':').length === 2) {
    fullStr += ':00';
  }
  if (!fullStr.endsWith('Z') && !/\+\d{2}:?\d{2}$/.test(fullStr) && !/-\d{2}:?\d{2}$/.test(fullStr)) {
    fullStr += '.000Z';
  }
  const d = new Date(fullStr);
  return isNaN(d.getTime()) ? null : d;
};

export const getDeploymentAnalysis = async (userId, id, startDate, endDate, startTime, endTime) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  const Trade = (await import("../models/trade.js")).default;
  
  // Build time filter
  const timeFilter = { deployment_id: deployment._id };
  const start = parseDateTime(startDate, startTime, '00:00');
  const end = parseDateTime(endDate, endTime, '23:59:59');

  if (start || end) {
    timeFilter.created_at = {};
    if (start) timeFilter.created_at.$gte = start;
    if (end) timeFilter.created_at.$lte = end;
  }

  const trades = await Trade.find(timeFilter).sort({ created_at: 1 });

  const totalTrades = trades.length;
  let totalPnL = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;

  let positionSize = 0;
  let averageEntryPrice = 0;
  let peakEquity = 0;
  let troughEquity = 0;
  let maxDrawdown = 0;
  let maxDrawup = 0;
  let runningPnL = 0;

  const timeSeriesData = [];
  const intradayTrades = [];

  for (const trade of trades) {
    const qty = trade.quantity || 0;
    const price = trade.price || 0;
    const isBuy = trade.type_of_order === "BUY";
    const commission = trade.commission || 0;
    let pnl = 0;

    if (isBuy) {
      if (positionSize >= 0) {
        const newSize = positionSize + qty;
        averageEntryPrice = newSize > 0 ? (averageEntryPrice * positionSize + price * qty + commission) / newSize : 0;
        positionSize = newSize;
      } else {
        const coveredQty = Math.min(Math.abs(positionSize), qty);
        pnl = (averageEntryPrice - price) * coveredQty - commission;
        const remainingQty = qty - coveredQty;
        positionSize += coveredQty;
        if (remainingQty > 0) {
          positionSize = remainingQty;
          averageEntryPrice = price;
        } else if (positionSize === 0) {
          averageEntryPrice = 0;
        }
      }
    } else {
      if (positionSize <= 0) {
        const newSize = positionSize - qty;
        const absNewSize = Math.abs(newSize);
        averageEntryPrice = absNewSize > 0 ? (averageEntryPrice * Math.abs(positionSize) + price * qty + commission) / absNewSize : 0;
        positionSize = newSize;
      } else {
        const exitedQty = Math.min(positionSize, qty);
        pnl = (price - averageEntryPrice) * exitedQty - commission;
        const remainingQty = qty - exitedQty;
        positionSize -= exitedQty;
        if (remainingQty > 0) {
          positionSize = -remainingQty;
          averageEntryPrice = price;
        } else if (positionSize === 0) {
          averageEntryPrice = 0;
        }
      }
    }

    if (pnl !== 0) {
      totalPnL += pnl;
      runningPnL += pnl;
      
      if (pnl > 0) {
        wins++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        losses++;
        grossLoss += Math.abs(pnl);
      }

      // Track peak and trough for drawdown/drawup
      if (runningPnL > peakEquity) {
        peakEquity = runningPnL;
      }
      if (runningPnL < troughEquity) {
        troughEquity = runningPnL;
      }

      // Calculate drawdown (peak to current)
      const currentDrawdown = peakEquity - runningPnL;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Calculate drawup (trough to current)
      const currentDrawup = runningPnL - troughEquity;
      if (currentDrawup > maxDrawup) {
        maxDrawup = currentDrawup;
      }

      // Add to time series
      timeSeriesData.push({
        timestamp: trade.created_at,
        pnl: parseFloat(runningPnL.toFixed(2)),
        trade_id: trade.trade_id,
      });

      // Add to intraday trades with time-of-day breakdown
      const tradeDate = new Date(trade.created_at);
      const hour = tradeDate.getUTCHours();
      const minute = tradeDate.getUTCMinutes();
      const second = tradeDate.getUTCSeconds();
      const timeOfDay = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
      
      intradayTrades.push({
        timestamp: trade.created_at,
        time_of_day: timeOfDay,
        hour,
        minute,
        second,
        pnl: parseFloat(pnl.toFixed(2)),
        trade_id: trade.trade_id,
        type_of_order: trade.type_of_order,
      });
    }
  }

  // Calculate profitability factor
  const profitabilityFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0);

  return {
    deployment_id: deployment._id,
    deployment_name: deployment.deployment_name,
    symbol: deployment.symbol,
    strategy_mode: deployment.strategy_mode,
    time_range: {
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
    },
    metrics: {
      total_trades: totalTrades,
      total_pnl: parseFloat(totalPnL.toFixed(2)),
      gross_profit: parseFloat(grossProfit.toFixed(2)),
      gross_loss: parseFloat(grossLoss.toFixed(2)),
      profitability_factor: profitabilityFactor === Infinity ? "Infinity" : parseFloat(profitabilityFactor.toFixed(2)),
      wins,
      losses,
      win_rate: (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(2) + "%" : "0.00%",
      max_drawdown: parseFloat(maxDrawdown.toFixed(2)),
      max_drawup: parseFloat(maxDrawup.toFixed(2)),
    },
    time_series: timeSeriesData,
    intraday_trades: intradayTrades,
  };
};;

export const syncAllDeploymentsToRedis = async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("⚠️ REDIS_URL not set, skipping deployment sync to Redis");
    return;
  }

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();

    // Fetch all RUNNING deployments
    const runningDeployments = await Deployment.find({ current_status: "RUNNING" })
      .populate("strategy_id")
      .populate({
        path: "account_id",
        populate: { path: "broker_id" }
      });

    const newKeysData = {};

    for (const dep of runningDeployments) {
      if (!dep.strategy_id || !dep.account_id) continue;
      const symbol = dep.symbol;
      const isBacktest = dep.strategy_mode === "BACKTEST";
      const isTest = dep.strategy_mode !== "LIVE"; // PAPER or BACKTEST
      const key = isBacktest ? `strategies:backtest:${symbol}` : `strategies:live:${symbol}`;

      if (!newKeysData[key]) {
        newKeysData[key] = [];
      }

      newKeysData[key].push({
        name: dep.strategy_id.strategy_name,
        isTest: isTest,
        account_id: dep.account_id.account_id || dep.account_id._id.toString(),
        user_symbol_id: dep.user_symbol_id ? dep.user_symbol_id.toString() : undefined,
        instrument_token: dep.instrument_token,
        symbol: dep.symbol,
        strategy_id: dep.strategy_id._id.toString(),
        deployment_id: dep._id.toString(),
        user_id: dep.user_id.toString(),
        strategy_mode: dep.strategy_mode,
        is_internal_broker: dep.account_id.broker_id ? dep.account_id.broker_id.is_internal : false,
        use_full_amount: dep.use_full_amount || false,
        commission_type: dep.account_id.commission_type || "PERCENTAGE",
        commission_rate: dep.account_id.commission_rate || 0,
        target_pts: dep.strategy_id.target_pts !== undefined ? dep.strategy_id.target_pts : 500,
        sl_pts: dep.strategy_id.sl_pts !== undefined ? dep.strategy_id.sl_pts : 500,
        target_type: dep.strategy_id.target_type || "POINTS",
        target_pct: dep.strategy_id.target_pct !== undefined ? dep.strategy_id.target_pct : 2,
        sl_pct: dep.strategy_id.sl_pct !== undefined ? dep.strategy_id.sl_pct : 2,
        advance_trade_decision: dep.strategy_id.advance_trade_decision || false,
        params: dep.strategy_id.params || {},
        backtest_run_id: dep.backtest_run_id || "",
      });

      // Sync account balance to Redis
      const accountId = dep.account_id.account_id || dep.account_id._id.toString();
      const balanceKey = `account_balance:${accountId}`;
      const balanceData = { balance: dep.account_id.current_balance };
      try {
        if (typeof client.json?.set === 'function') {
          await client.json.set(balanceKey, '.', balanceData);
        } else {
          await client.set(balanceKey, JSON.stringify(balanceData));
        }
        console.log(`[Sync] Synced account balance for ${accountId} to Redis: ${dep.account_id.current_balance}`);
      } catch (err) {
        console.error(`[Sync] Failed to sync account balance for ${accountId} to Redis: ${err.message}`);
      }
    }

    // Scan Redis for existing strategy keys to clean up
    const liveKeys = await client.keys("strategies:live:*");
    const backtestKeys = await client.keys("strategies:backtest:*");
    const allExistingKeys = [...liveKeys, ...backtestKeys];

    for (const key of allExistingKeys) {
      if (!newKeysData[key]) {
        await client.del(key);
        console.log(`Deleted stale Redis key: ${key}`);
      }
    }

    for (const [key, activeStrategies] of Object.entries(newKeysData)) {
      await client.del(key);
      if (typeof client.json?.set === 'function') {
        await client.json.set(key, '.', { activeStrategies });
      } else {
        await client.set(key, JSON.stringify({ activeStrategies }));
      }
      console.log(`Updated Redis key ${key} with ${activeStrategies.length} active strategies`);
    }

  } catch (error) {
    console.error("❌ Failed to sync deployments to Redis:", error.message);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }

  // Keep symbol_control consumer index in sync whenever strategy routing is refreshed
  try {
    await syncControlledDeploymentsIndex();
  } catch (err) {
    console.error("[SymbolControl] Index sync after deployment Redis sync failed:", err.message);
  }
};

export const getDeploymentCandles = async (userId, id, timeframe = "1m") => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  const symbol = deployment.symbol;
  const date = deployment.backtest_date || new Date().toISOString().slice(0, 10);

  return await getSymbolCandles(symbol, date, timeframe);
};
