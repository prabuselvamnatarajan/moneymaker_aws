import Deployment from "../models/deployment.js";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import Trade from "../models/trade.js";
import Ledger from "../models/ledger.js";
import Position from "../models/position.js";
import Account from "../models/account.js";
import UserSymbol from "../models/userSymbol.js";
import Strategy from "../models/strategy.js";
import Broker from "../models/broker.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";
import { createClient } from "redis";
import { getSymbolCandles, publishSymbolUpdate } from "./symbol.js";
import {
  resolveOptionSymbol,
  computeReferenceStrike,
  resolveExpiryDate,
} from "./optionSymbolResolver.js";
import { purgePositionsFromRedis, readLiveCache } from "../utils/positionRedis.js";
import { sumOpenUnrealised, round2, resolveCloseExecutionTime } from "../utils/positionMath.js";
import { completionKey as backtestCompletionKey } from "../utils/backtestCompletionUtil.js";

const USER_UPDATABLE_FIELDS = ["deployment_name", "notes", "backtest_date", "backtest_speed", "use_full_amount", "no_of_lots", "timeframe", "symbol_control"];

const ALLOWED_TIMEFRAMES = ["1m", "3m", "5m", "15m"];

const normalizeTimeframe = (tf) => {
  if (!tf) return "1m";
  const str = String(tf).trim().toLowerCase();
  const map = {
    "1m": "1m",
    "1minute": "1m",
    "1_minute": "1m",
    "3m": "3m",
    "3minute": "3m",
    "3_minute": "3m",
    "5m": "5m",
    "5minute": "5m",
    "5_minute": "5m",
    "15m": "15m",
    "15minute": "15m",
    "15_minute": "15m",
  };
  const normalized = map[str];
  if (!normalized || !ALLOWED_TIMEFRAMES.includes(normalized)) {
    throw new Error(`Invalid timeframe: '${tf}'. Allowed values are 1m (1minute), 3m (3minute), 5m (5minute), 15m (15minute).`);
  }
  return normalized;
};

const normalizeNoOfLots = (value) => {
  const n = Number(value);
  if (!(n >= 1) || !Number.isFinite(n)) {
    throw new Error("no_of_lots must be an integer >= 1");
  }
  return Math.floor(n);
};

const hasOpenPosition = async (deploymentId) => {
  const openPos = await Position.findOne({
    deployment_id: deploymentId,
    status: "OPEN",
  }).select("open_size");
  if (openPos) {
    return openPos.open_size !== 0;
  }

  // position_size is written in the same transaction as the Position document, so a
  // non-zero counter with no OPEN position is drift. Reconcile it rather than leaving the
  // deployment permanently unable to start, restart, or change timeframe.
  const dep = await Deployment.findById(deploymentId).select("position_size");
  if (!dep || dep.position_size === 0) {
    return false;
  }
  console.warn(
    `[Deployment] position_size=${dep.position_size} on ${deploymentId} with no OPEN position; reconciling to 0`
  );
  await Deployment.updateOne(
    { _id: deploymentId },
    { $set: { position_size: 0, average_entry_price: 0 } }
  );
  return false;
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

const unsubscribeSymbolTokenIfUnused = async (instrumentToken, userId, excludeDeploymentId) => {
  if (!instrumentToken) return;
  const stillUsed = await Deployment.exists({
    _id: { $ne: excludeDeploymentId },
    instrument_token: instrumentToken,
    current_status: { $in: ["RUNNING", "SCHEDULED", "PAUSED"] },
  });
  if (stillUsed) return;

  // ConnectWS-Upstox unsubscribes globally — only drop the feed if no user
  // (any tenant) still has this instrument active on their watchlist.
  const stillActiveGlobally = await UserSymbol.exists({
    instrument_token: instrumentToken,
    is_active: true,
  });
  if (stillActiveGlobally) return;

  try {
    await publishSymbolUpdate({
      action: "unsubscribe",
      instrument_token: instrumentToken,
      userId,
    });
  } catch (err) {
    console.error("[Deployment Service] Failed to publish symbol unsubscribe:", err.message);
  }
};


/**
 * Rename deployment-scoped Redis keys that embed the old option symbol so strategy
 * runtime state follows the remap (avoids cold start for per-deployment keys).
 */
const migrateDeploymentScopedRedisKeys = async (deploymentId, oldSymbol, newSymbol) => {
  if (!oldSymbol || !newSymbol || oldSymbol === newSymbol) return;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();
    const deploymentIdStr = deploymentId.toString();
    let cursor = 0;
    const renamed = [];
    do {
      const reply = await client.scan(cursor, { MATCH: `*${deploymentIdStr}*`, COUNT: 100 });
      cursor = reply.cursor;
      for (const key of reply.keys || []) {
        if (!key.includes(oldSymbol)) continue;
        const newKey = key.split(oldSymbol).join(newSymbol);
        if (newKey === key) continue;
        try {
          await client.rename(key, newKey);
          renamed.push({ from: key, to: newKey });
        } catch (err) {
          // Key may vanish between SCAN and RENAME
          console.warn(`[SymbolControl] Redis rename skipped ${key}: ${err.message}`);
        }
      }
    } while (cursor !== 0);

    if (renamed.length > 0) {
      console.log(
        `[SymbolControl] Migrated ${renamed.length} Redis keys for deployment ${deploymentIdStr}`
      );
    }
  } catch (err) {
    console.error(`[SymbolControl] Redis state migration failed: ${err.message}`);
  } finally {
    if (client) await client.disconnect();
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

    // SCAN (not KEYS) to avoid blocking Redis under load
    const staleKeys = [];
    let cursor = 0;
    do {
      const reply = await client.scan(cursor, { MATCH: "symbol_control:deps:*", COUNT: 100 });
      cursor = reply.cursor;
      for (const key of reply.keys || []) {
        const token = key.replace("symbol_control:deps:", "");
        if (!byUnderlying[token]) staleKeys.push(key);
      }
    } while (cursor !== 0);
    if (staleKeys.length > 0) {
      await client.del(staleKeys);
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
  const oldSymbol = deployment.symbol;
  deployment.user_symbol_id = resolved.user_symbol_id;
  deployment.instrument_token = resolved.instrument_token;
  deployment.symbol = resolved.symbol;
  if (Number(resolved.lot_size) > 0) {
    deployment.lot_size = Number(resolved.lot_size);
  } else if (Number(deployment.lot_size) > 0) {
    // Keep existing snapshot; ensure option record has it if missing
    const optionSym = await UserSymbol.findById(resolved.user_symbol_id);
    if (optionSym && !(Number(optionSym.lot_size) > 0)) {
      optionSym.lot_size = deployment.lot_size;
      await optionSym.save();
    }
  }
  deployment.symbol_control.last_resolved_strike =
    referenceStrike != null ? referenceStrike : resolved.atm_strike;
  deployment.symbol_control.last_resolved_at = new Date();
  deployment.symbol_control.pending_resolve = false;
  deployment.symbol_control.last_resolve_error = null;
  await deployment.save();

  // Primary + adjacent options are ensured by resolveOptionSymbol; re-subscribe primary
  await subscribeSymbolToken(resolved.instrument_token, deployment.user_id);
  if (Array.isArray(resolved.adjacent)) {
    for (const adj of resolved.adjacent) {
      await subscribeSymbolToken(adj.instrument_token, deployment.user_id);
    }
  }

  if (oldToken && oldToken !== resolved.instrument_token) {
    await migrateDeploymentScopedRedisKeys(deployment._id, oldSymbol, resolved.symbol);
    await unsubscribeSymbolTokenIfUnused(oldToken, deployment.user_id, deployment._id);
  }

  try {
    const { syncAllActiveSymbolsToRedis } = await import("./symbol.js");
    await syncAllActiveSymbolsToRedis();
  } catch (err) {
    console.error("[SymbolControl] Failed to sync active symbols after remap:", err.message);
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
  if (!mongoose.isValidObjectId(deploymentId)) {
    throw new Error("Deployment not found");
  }
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
    // Accept tick LTP only when finite and positive; otherwise resolver fetches server-side
    const tickLtp = Number(options.ltp);
    const safeLtp = Number.isFinite(tickLtp) && tickLtp > 0 ? tickLtp : undefined;

    const resolved = await resolveOptionSymbol({
      userId: deployment.user_id.toString(),
      underlyingSymbol: underlyingToken,
      moneyness: sc.moneyness || "ITM",
      offset: sc.offset || 1,
      optionType: sc.option_type || "CE",
      expiry: sc.expiry,
      ltp: safeLtp,
      ensureAdjacent: true,
      lotSize: Number(deployment.lot_size) > 0 ? Number(deployment.lot_size) : null,
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

    // No-op if already on this option and strike (adjacent watch still refreshed above)
    if (
      deployment.instrument_token === resolved.instrument_token &&
      deployment.symbol_control.last_resolved_strike === referenceStrike
    ) {
      deployment.symbol_control.pending_resolve = false;
      deployment.symbol_control.last_resolve_error = null;
      deployment.symbol_control.last_resolved_at = new Date();
      await deployment.save();
      try {
        const { syncAllActiveSymbolsToRedis } = await import("./symbol.js");
        await syncAllActiveSymbolsToRedis();
      } catch (err) {
        console.error("[SymbolControl] Failed to sync active symbols:", err.message);
      }
      await syncControlledDeploymentsIndex();
      return { deferred: false, unchanged: true, deployment };
    }

    await applyResolvedOptionToDeployment(deployment, resolved, referenceStrike);
    return { deferred: false, unchanged: false, deployment, resolved };
  } catch (err) {
    deployment.symbol_control.last_resolve_error = err.message;
    await deployment.save();
    try {
      await syncControlledDeploymentsIndex();
    } catch (syncErr) {
      console.error("[SymbolControl] Index sync after error failed:", syncErr.message);
    }
    throw err;
  }
};

/**
 * Called when a deployment position goes flat; flushes pending_resolve if set.
 */
export const flushPendingSymbolResolve = async (deploymentId) => {
  if (!mongoose.isValidObjectId(deploymentId)) {
    return null;
  }
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
  const underlyingClass = String(underlying.instrument_class || "").toUpperCase();
  if (underlyingClass === "OPTION") {
    throw new Error("symbol_control underlying cannot be an OPTION UserSymbol");
  }
  if (!(Number(underlying.strike_price_diff) > 0)) {
    throw new Error("Underlying symbol must have strike_price_diff > 0");
  }

  const lotSize = Number(deploymentData.lot_size);
  if (!(lotSize > 0)) {
    throw new Error("lot_size is required for dynamic option deployments and must be > 0");
  }

  const expiryDate = resolveExpiryDate(sc.expiry);

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
    expiry: expiryDate,
    ensureAdjacent: true,
    lotSize,
  });

  // Adjacent options are created/activated by resolveOptionSymbol; keep Redis watch set current
  try {
    const { syncAllActiveSymbolsToRedis } = await import("./symbol.js");
    await syncAllActiveSymbolsToRedis();
  } catch (err) {
    console.error("[SymbolControl] Failed to sync active symbols after create resolve:", err.message);
  }

  const referenceStrike = computeReferenceStrike(resolved.ltp, underlying.strike_price_diff);

  return {
    ...deploymentData,
    user_symbol_id: resolved.user_symbol_id,
    instrument_token: resolved.instrument_token,
    symbol: resolved.symbol,
    lot_size: Number(resolved.lot_size) > 0 ? Number(resolved.lot_size) : lotSize,
    symbol_control: {
      enabled: true,
      underlying_user_symbol_id: underlying._id,
      underlying_instrument_token: underlying.instrument_token,
      moneyness: String(sc.moneyness).toUpperCase(),
      offset: sc.offset || 1,
      option_type: String(sc.option_type).toUpperCase(),
      expiry: expiryDate,
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
    const timeMs = (deployment.backtest_speed !== undefined && deployment.backtest_speed !== null) ? deployment.backtest_speed : 0;
    
    const runId = Date.now().toString();
    deployment.backtest_run_id = runId;
    await deployment.save();
    await syncAllDeploymentsToRedis();
    
    const triggerUrl = `${process.env.BACKTEST_CLIENT_URL || "http://backtest-client"}/?symbolName=${encodeURIComponent(symbolName)}&date=${encodeURIComponent(date)}&time_ms=${timeMs}&deployment_id=${encodeURIComponent(deployment._id.toString())}&run_id=${runId}`;
    console.log(`[Backtest] Triggering backtest client with run_id ${runId}: ${triggerUrl}`);
    fetch(triggerUrl)
      .then(res => res.text())
      .then(body => console.log(`[Backtest] Trigger response: ${body}`))
      .catch(err => console.error(`[Backtest] Error triggering backtest: ${err.message}`));
  }
};

async function clearStrategyHoldingsKeys(deployment) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !deployment?._id) return;
  const deploymentId = deployment._id.toString();
  const altDeploymentId = deployment.deployment_id ? String(deployment.deployment_id) : null;
  const symbol = String(deployment.symbol || "").toUpperCase();
  let client;
  try {
    client = createClient({ url: redisUrl });
    client.on("error", (err) => console.error(`[ForceClose] redis error: ${err.message}`));
    await client.connect();
    const ids = [deploymentId];
    if (altDeploymentId && altDeploymentId !== deploymentId) ids.push(altDeploymentId);
    const keys = [];
    for (const id of ids) {
      keys.push(`bought_quantity:${id}:${symbol}`);
      keys.push(`bought_quantity:${id}:${deployment.symbol}`);
      keys.push(`short_quantity:${id}:${symbol}`);
      keys.push(`short_quantity:${id}:${deployment.symbol}`);
    }
    for (const key of keys) {
      await client.del(key).catch(() => {});
    }
  } catch (err) {
    console.error(`[ForceClose] Failed clearing holdings keys for ${deploymentId}: ${err.message}`);
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
}

/**
 * Force-close any still-open positions at end of a backtest run via createTrade
 * so realised P&L, ledger and account balance stay consistent.
 *
 * @param {Object} finalTick - { lastLtp, lastTickAt } from the streamer's done
 *   signal. This is the authoritative end-of-data mark: the position tracker is
 *   a separate consumer group that can still be behind the final ticks (or have
 *   never seen a position opened right at the end), so its cache is only a
 *   fallback.
 */
export const forceCloseOpenPositions = async (deployment, finalTick = {}) => {
  if (!deployment?._id) return { closed: 0, skipped: 0, stillOpen: 0 };

  const finalLtpRaw = Number(finalTick?.lastLtp);
  const finalLtp = Number.isFinite(finalLtpRaw) && finalLtpRaw > 0 ? finalLtpRaw : null;
  const finalTickAtRaw = Number(finalTick?.lastTickAt);
  const finalTickAt =
    Number.isFinite(finalTickAtRaw) && finalTickAtRaw > 0 ? new Date(finalTickAtRaw) : null;

  const openPositions = await Position.find({
    deployment_id: deployment._id,
    status: "OPEN",
    open_size: { $gt: 0 },
  });

  if (openPositions.length === 0) {
    await clearStrategyHoldingsKeys(deployment);
    return { closed: 0, skipped: 0, stillOpen: 0 };
  }

  const { createTrade } = await import("./trade.js");
  let closed = 0;
  let skipped = 0;

  for (const pos of openPositions) {
    const liveCache = await readLiveCache(pos._id.toString());
    const cachedLtp = liveCache?.lastLtp > 0 ? liveCache.lastLtp : null;
    const price = finalLtp || cachedLtp || pos.last_ltp;

    if (!(price > 0) || !(pos.open_size > 0)) {
      console.warn(
        `[ForceClose] Skipping position ${pos._id} for deployment ${deployment._id}: missing last_ltp or open_size`
      );
      skipped += 1;
      continue;
    }

    // Redis is ahead of Mongo between throttled tracker writes, so fold the
    // freshest mark and excursions in before close accounting reads them.
    if (cachedLtp) {
      pos.last_ltp = cachedLtp;
      if (typeof liveCache.unrealisedPnl === "number") {
        pos.unrealised_pnl = liveCache.unrealisedPnl;
      }
      pos.max_up = Math.max(pos.max_up || 0, liveCache.maxUp || 0);
      pos.max_down = Math.min(pos.max_down || 0, liveCache.maxDown || 0);
      pos.max_up_pct = Math.max(pos.max_up_pct || 0, liveCache.maxUpPct || 0);
      pos.max_down_pct = Math.min(pos.max_down_pct || 0, liveCache.maxDownPct || 0);
      if (liveCache.lastTickAt > 0) {
        pos.last_tick_at = new Date(liveCache.lastTickAt);
      }
    }

    // The final replayed tick outranks the tracker cache. Excursions and
    // realised P&L are folded in from the close price by finalizeClosePosition,
    // so only the mark and its tick time are worth persisting here — the tick
    // time is what dates the closing trade below.
    if (finalLtp) {
      pos.last_ltp = finalLtp;
      if (finalTickAt) {
        pos.last_tick_at = finalTickAt;
      }
    }

    if (cachedLtp || finalLtp) {
      await pos.save().catch(() => {});
    }

    const type_of_order = pos.direction === "LONG" ? "SELL" : "BUY";
    const executionTime = resolveCloseExecutionTime(pos.opened_at, pos.last_tick_at);

    try {
      await createTrade({
        user_id: deployment.user_id,
        deployment_id: deployment._id,
        account_id: deployment.account_id || pos.account_id,
        strategy_id: deployment.strategy_id || pos.strategy_id,
        user_symbol_id: deployment.user_symbol_id || pos.user_symbol_id,
        instrument_token: deployment.instrument_token || pos.instrument_token,
        symbol: pos.symbol || deployment.symbol,
        type_of_order,
        quantity: pos.open_size,
        price,
        execution_time: executionTime,
        force_close: true,
      });
      closed += 1;
      const priceSource = finalLtp ? "final-tick" : cachedLtp ? "live-cache" : "position";
      console.log(
        `[ForceClose] Closed ${pos.direction} position ${pos._id} qty=${pos.open_size} ` +
          `@ ${price} (${priceSource}) for deployment ${deployment._id}`
      );
    } catch (err) {
      skipped += 1;
      console.error(
        `[ForceClose] Failed to close position ${pos._id} for deployment ${deployment._id}: ${err.message}`
      );
    }
  }

  await clearStrategyHoldingsKeys(deployment);

  const stillOpen = await Position.countDocuments({
    deployment_id: deployment._id,
    status: "OPEN",
    open_size: { $gt: 0 },
  });
  if (stillOpen > 0) {
    console.error(
      `[ForceClose] CRITICAL: deployment ${deployment._id} still has ${stillOpen} OPEN position(s) after force-close`
    );
  }

  return { closed, skipped, stillOpen };
};

const resetBacktestDeployment = async (deployment) => {
  if (deployment.strategy_mode !== "BACKTEST") {
    return;
  }

  const deploymentId = deployment._id;
  const symbol = deployment.symbol;

  try {
    // 1. Purge Redis live/open index for positions before Mongo delete
    const positionsToPurge = await Position.find({ deployment_id: deploymentId }).select("_id symbol").lean();
    await purgePositionsFromRedis(positionsToPurge);

    // Clear stale completion flag so the watcher cannot stop a brand-new run
    const redisUrlForFlag = process.env.REDIS_URL;
    if (redisUrlForFlag) {
      let flagClient;
      try {
        flagClient = createClient({ url: redisUrlForFlag });
        flagClient.on("error", (err) => console.error(`[Reset] redis error: ${err.message}`));
        await flagClient.connect();
        await flagClient.del(backtestCompletionKey(deploymentId.toString()));
      } catch (err) {
        console.warn(`[Reset] Failed clearing backtest_completed flag: ${err.message}`);
      } finally {
        if (flagClient) await flagClient.disconnect().catch(() => {});
      }
    }

    // 2. Delete trades, ledgers and positions in MongoDB for this deployment
    const deletedTrades = await Trade.deleteMany({ deployment_id: deploymentId });
    const deletedLedgers = await Ledger.deleteMany({ deployment_id: deploymentId });
    const deletedPositions = await Position.deleteMany({ deployment_id: deploymentId });
    console.log(`[Reset] Deleted ${deletedTrades.deletedCount} trades, ${deletedLedgers.deletedCount} ledgers, and ${deletedPositions.deletedCount} positions for deployment ${deploymentId}`);

    // Reset cached position state on deployment. Clearing backtest_run_id matters:
    // the deployment is already RUNNING here but triggerBacktestIfNeeded does not
    // mint the new run id until later, and a late {done} from the previous run
    // would otherwise match the old id and stop the run that is just starting.
    deployment.position_size = 0;
    deployment.average_entry_price = 0;
    deployment.backtest_run_id = null;
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
        const altDeploymentIdStr = deployment.deployment_id ? String(deployment.deployment_id) : null;
        const idPatterns = [deploymentIdStr];
        if (altDeploymentIdStr && altDeploymentIdStr !== deploymentIdStr) {
          idPatterns.push(altDeploymentIdStr);
        }

        // Safe non-blocking SCAN loop to delete all keys containing any matching deployment ID.
        // Preserve deployment_state_epoch so strategy consumers never see a missing epoch mid-reset.
        for (const targetId of idPatterns) {
          let cursor = 0;
          const pattern = `*${targetId}*`;
          const epochKey = getStateEpochKey(targetId);
          do {
            const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
            cursor = reply.cursor;
            const keys = (reply.keys || []).filter((k) => k !== epochKey);
            if (keys.length > 0) {
              await client.del(keys);
              console.log(`[Reset] Deleted scanned keys for deployment pattern ${pattern}:`, keys);
            }
          } while (cursor !== 0);

          // Ensure epoch exists before backtest ticks start flowing
          await ensureDeploymentStateEpoch(client, targetId);
        }
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

const resolveStrategyName = async (deployment) => {
  const inlineName = deployment.strategy_id?.strategy_name;
  if (inlineName) {
    return inlineName;
  }
  if (!deployment.strategy_id) {
    return undefined;
  }
  const strategy = await Strategy.findById(deployment.strategy_id);
  return strategy?.strategy_name;
};

const STATE_EPOCH_KEY_PREFIX = "deployment_state_epoch:";

const getStateEpochKey = (deploymentId) => `${STATE_EPOCH_KEY_PREFIX}${deploymentId}`;

/**
 * Ensure a deployment has a Redis state_epoch (used to invalidate in-flight ticks after TF change).
 * Fails loudly if Redis is unavailable.
 */
const ensureDeploymentStateEpoch = async (client, deploymentId) => {
  const key = getStateEpochKey(deploymentId);
  const existing = await client.get(key);
  if (existing == null || existing === "") {
    await client.set(key, "1");
    return 1;
  }
  const epoch = Number(existing);
  if (!Number.isFinite(epoch)) {
    throw new Error(`Invalid ${key} value: ${existing}`);
  }
  return epoch;
};

/**
 * Bump state_epoch so strategy consumers refuse writes from pre-reset Kafka messages.
 */
const bumpDeploymentStateEpoch = async (client, deploymentId) => {
  const key = getStateEpochKey(deploymentId);
  // Ensure key exists then incr — INCR on missing key starts at 1 in Redis, but we want bump from current
  await ensureDeploymentStateEpoch(client, deploymentId);
  const epoch = await client.incr(key);
  console.log(`[Reset] Bumped state_epoch for deployment ${deploymentId} → ${epoch}`);
  return epoch;
};

/**
 * Clear Redis strategy runtime state for a deployment (candleState / swings / volume profile).
 * Used when timeframe changes so engines do not keep evaluating under stale bucket semantics.
 * Does not wipe Mongo positions/trades — only Redis keys matching the deployment id.
 * Fails loudly if REDIS_URL is unset or Redis operations fail.
 */
const resetDeploymentStrategyRuntimeState = async (deployment, { bumpEpoch = false } = {}) => {
  const deploymentIdStr = deployment._id.toString();
  const symbol = deployment.symbol;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required to reset deployment strategy runtime state");
  }

  const strategyName = await resolveStrategyName(deployment);

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();

    if (bumpEpoch) {
      await bumpDeploymentStateEpoch(client, deploymentIdStr);
    } else {
      await ensureDeploymentStateEpoch(client, deploymentIdStr);
    }

    // Prefer precise strategy state keys when strategy name is known
    if (strategyName) {
      for (const mode of ["backtest", "live"]) {
        const stateKey = `strategies:${strategyName}:${mode}:${deploymentIdStr}:${symbol}`;
        if (strategyName === LIQUIDITY_SWEEP_STRATEGY) {
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
            }
          }
        }
        await client.del(stateKey);
        console.log(`[Reset] Cleared strategy state key after timeframe change: ${stateKey}`);
      }
    }

    // Also clear any other deployment-scoped strategy keys (candle/swing/volume profile, etc.).
    // Preserve epoch + quantity caches: TF change is blocked while Mongo shows an open position,
    // but position tracker can lag — wiping bought/short qty would orphan live holdings.
    let cursor = 0;
    const pattern = `*${deploymentIdStr}*`;
    const epochKey = getStateEpochKey(deploymentIdStr);
    const isBacktest = deployment.strategy_mode === "BACKTEST";
    const isProtectedKey = (k) =>
      k === epochKey
      || (!isBacktest && (k.startsWith("bought_quantity:") || k.startsWith("short_quantity:")));
    do {
      const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = reply.cursor;
      const keys = (reply.keys || []).filter((k) => !isProtectedKey(k));
      if (keys.length > 0) {
        await client.del(keys);
        console.log(`[Reset] Deleted runtime keys for deployment ${deploymentIdStr}:`, keys);
      }
    } while (cursor !== 0);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
};

const resetLiquiditySweepRuntimeState = async (deployment) => {
  if ((await resolveStrategyName(deployment)) !== LIQUIDITY_SWEEP_STRATEGY) {
    return;
  }
  // Bump the epoch so a tick enriched just before the delete cannot write the
  // pre-reset state back. transitionDeployment republishes the new epoch via
  // syncAllDeploymentsToRedis before returning.
  await resetDeploymentStrategyRuntimeState(deployment, { bumpEpoch: true });
};

export const createDeployment = async (userId, deploymentData) => {
  const prepared = await prepareSymbolControlOnCreate(userId, deploymentData);

  if (prepared.strategy_id) {
    const strategy = await Strategy.findOne({
      _id: prepared.strategy_id,
      user_id: userId,
    });
    if (!strategy) {
      throw new Error("Associated strategy not found");
    }
  }

  if (prepared.account_id) {
    const account = await Account.findOne({
      _id: prepared.account_id,
      user_id: userId,
    });
    if (!account) {
      throw new Error("Associated account not found");
    }
  }

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

    const symbolClass = String(symbol.instrument_class || "").toUpperCase();
    if (symbolClass === "OPTION") {
      const lotFromSymbol = Number(symbol.lot_size);
      const lotFromPayload = Number(prepared.lot_size);
      const lotSize = lotFromSymbol > 0 ? lotFromSymbol : lotFromPayload;
      if (!(lotSize > 0)) {
        throw new Error("OPTION symbol is missing lot_size; set lot_size on the UserSymbol before deploying");
      }
      prepared.lot_size = lotSize;
    } else if (!(Number(prepared.lot_size) > 0)) {
      prepared.lot_size = null;
    }
  } else {
    throw new Error("user_symbol_id is required (or enable symbol_control to auto-resolve)");
  }

  if (prepared.no_of_lots !== undefined && prepared.no_of_lots !== null) {
    prepared.no_of_lots = normalizeNoOfLots(prepared.no_of_lots);
  } else {
    prepared.no_of_lots = 1;
  }

  prepared.timeframe = normalizeTimeframe(prepared.timeframe);

  if (["RUNNING", "SCHEDULED"].includes(prepared.current_status)) {
    const existingActive = await Deployment.findOne({
      strategy_id: prepared.strategy_id,
      account_id: prepared.account_id,
      instrument_token: prepared.instrument_token,
      current_status: { $in: ["RUNNING", "SCHEDULED"] },
    });
    if (existingActive) {
      const dupErr = new Error(
        `E11000 duplicate key error collection: deployments index: strategy_id_1_account_id_1_instrument_token_1_current_status_1 dup key: { strategy_id: ObjectId('${prepared.strategy_id}'), account_id: ObjectId('${prepared.account_id}'), instrument_token: "${prepared.instrument_token}", current_status: "${prepared.current_status}" }`
      );
      dupErr.statusCode = 500;
      throw dupErr;
    }
  }

  const deployment = new Deployment({ ...prepared, user_id: userId });
  let result;
  try {
    result = await deployment.save();
  } catch (err) {
    if (err.code === 11000) {
      const dupErr = new Error(err.message);
      dupErr.statusCode = 500;
      throw dupErr;
    }
    throw err;
  }
  await resetBacktestDeployment(result);
  await syncAllDeploymentsToRedis();
  await triggerBacktestIfNeeded(result);
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
  const items = await Deployment.find(filter).sort(sort).skip(skip).limit(limit).lean();

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
  if (!mongoose.isValidObjectId(id)) {
    return null;
  }
  return await Deployment.findOne({ _id: id, user_id: userId }).populate("strategy_id");
};

export const updateDeployment = async (userId, id, updateData) => {
  if (!mongoose.isValidObjectId(id)) {
    return null;
  }
  const sanitizedUpdate = pickAllowedFields(updateData, USER_UPDATABLE_FIELDS);

  if (Object.keys(sanitizedUpdate).length === 0 && !updateData.symbol_control) {
    throw new Error("No valid fields provided for update");
  }

  if (sanitizedUpdate.no_of_lots !== undefined) {
    sanitizedUpdate.no_of_lots = normalizeNoOfLots(sanitizedUpdate.no_of_lots);
  }

  if (sanitizedUpdate.timeframe !== undefined) {
    sanitizedUpdate.timeframe = normalizeTimeframe(sanitizedUpdate.timeframe);
  }

  const existing = await Deployment.findOne({ _id: id, user_id: userId }).populate("strategy_id");
  if (!existing) {
    throw new Error("Deployment not found");
  }

  const previousTimeframe = existing.timeframe || "1m";
  const timeframeChanged = sanitizedUpdate.timeframe !== undefined
    && previousTimeframe !== sanitizedUpdate.timeframe;

  if (timeframeChanged && (await hasOpenPosition(existing._id))) {
    throw new Error("Cannot change timeframe while deployment has an open position. Close the position or stop the deployment first.");
  }

  if (updateData.symbol_control) {
    const sc = updateData.symbol_control;
    if (sc.enabled) {
      const underlyingId = sc.underlying_user_symbol_id || existing.symbol_control?.underlying_user_symbol_id;
      if (!underlyingId) {
        throw new Error("symbol_control.underlying_user_symbol_id is required when enabled");
      }
      const underlying = await UserSymbol.findOne({ _id: underlyingId, user_id: userId });
      if (!underlying) {
        throw new Error("Underlying symbol not found");
      }
      const expiryDate = resolveExpiryDate(sc.expiry || existing.symbol_control?.expiry);
      sanitizedUpdate.symbol_control = {
        enabled: true,
        underlying_user_symbol_id: underlying._id,
        underlying_instrument_token: underlying.instrument_token,
        moneyness: String(sc.moneyness || existing.symbol_control?.moneyness || "ITM").toUpperCase(),
        offset: sc.offset || existing.symbol_control?.offset || 1,
        option_type: String(sc.option_type || existing.symbol_control?.option_type || "CE").toUpperCase(),
        expiry: expiryDate,
        last_resolved_strike: existing.symbol_control?.last_resolved_strike,
        last_resolved_at: existing.symbol_control?.last_resolved_at,
        pending_resolve: existing.symbol_control?.pending_resolve || false,
        last_resolve_error: existing.symbol_control?.last_resolve_error,
      };
    } else {
      sanitizedUpdate.symbol_control = {
        enabled: false,
      };
    }
  }

  const updated = await Deployment.findOneAndUpdate(
    { _id: id, user_id: userId },
    sanitizedUpdate,
    {
      new: true,
      runValidators: true,
    }
  );

  try {
    if (timeframeChanged) {
      // Bump epoch + wipe candle/swing BEFORE any symbol-control sync that republishes Redis routing
      await resetDeploymentStrategyRuntimeState(existing, { bumpEpoch: true });
    }

    if (updated && updated.symbol_control?.enabled && !updateData.skip_resolve) {
      try {
        await resolveDeploymentSymbol(updated._id, { force: false });
      } catch (err) {
        console.error(`[SymbolControl] Re-resolve on update failed for ${updated._id}:`, err.message);
      }
    }

    // After TF change, sync must publish the new state_epoch or ticks will be stuck failing assertFreshStateEpoch
    await syncAllDeploymentsToRedis({ failLoud: timeframeChanged });
    await syncControlledDeploymentsIndex();
  } catch (err) {
    if (timeframeChanged) {
      // Roll back Mongo timeframe so UI/API and Redis routing cannot diverge permanently.
      // Do NOT bump epoch again — forward path already advanced it; a second bump can
      // leave activeStrategies advertising a stale epoch while Redis holds N+2.
      try {
        await Deployment.findOneAndUpdate(
          { _id: id, user_id: userId },
          { timeframe: previousTimeframe },
          { runValidators: true }
        );
        try {
          await syncAllDeploymentsToRedis({ failLoud: true });
        } catch (syncErr) {
          console.error(
            `[Deployment] CRITICAL: timeframe rolled back for ${id} but Redis sync failed (${syncErr.message}). ` +
            `Deployment may drop ticks until the next successful sync. Manual syncAllDeploymentsToRedis required.`
          );
        }
      } catch (rollbackErr) {
        console.error(`[Deployment] Timeframe rollback failed for ${id}:`, rollbackErr.message);
      }
    }
    throw err;
  }
  return updated;
};

export const deleteDeployment = async (userId, id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  // Cascade delete all child records: positions, trades, ledgers (all linked via deployment_id)
  const deletedPositions = await Position.deleteMany({ deployment_id: deployment._id, user_id: userId });
  const deletedTrades    = await Trade.deleteMany({ deployment_id: deployment._id, user_id: userId });
  const deletedLedger    = await Ledger.deleteMany({ deployment_id: deployment._id, user_id: userId });

  await Deployment.deleteOne({ _id: deployment._id });

  console.log(`[Deployment Service] Cascading delete complete for deployment ${deployment.deployment_name || deployment._id}: removed ${deletedTrades.deletedCount} trades, ${deletedPositions.deletedCount} positions, ${deletedLedger.deletedCount} ledger entries.`);

  // Clean orphaned epoch + runtime Redis keys for this deployment
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    let client;
    try {
      client = createClient({ url: redisUrl });
      await client.connect();
      const deploymentIdStr = deployment._id.toString();
      const epochKey = getStateEpochKey(deploymentIdStr);
      let cursor = 0;
      const pattern = `*${deploymentIdStr}*`;
      do {
        const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = reply.cursor;
        const keys = reply.keys || [];
        if (keys.length > 0) {
          await client.del(keys);
        }
      } while (cursor !== 0);
      await client.del(epochKey);
    } catch (err) {
      console.error(`[Deployment] Failed to clean Redis keys on delete for ${deployment._id}:`, err.message);
    } finally {
      if (client) {
        await client.disconnect();
      }
    }
  }

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

/**
 * @param {Object} options - { finalTick } forwarded to the backtest force-close
 *   so it marks out at the last replayed tick. Only set by the completion
 *   watcher; a manual stop has no end-of-data tick and falls back to the cache.
 */
export const transitionDeployment = async (userId, id, action, options = {}) => {
  if (!mongoose.isValidObjectId(id)) {
    return null;
  }
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

  // Only liquidity_sweep has its Redis runtime wiped on start|restart; MSB and msb_pts
  // keep their state, so blocking them here would be a restriction without a purpose.
  if (
    (action === "start" || action === "restart")
    && deployment.strategy_mode !== "BACKTEST"
    && (await resolveStrategyName(deployment)) === LIQUIDITY_SWEEP_STRATEGY
    && (await hasOpenPosition(deployment._id))
  ) {
    throw new Error(
      `Cannot ${action} this deployment while it has an open position, because ${action} clears its liquidity_sweep runtime state. Flatten the position first.`
    );
  }

  // Open backtest positions are flattened after the status flip is published, so
  // an in-flight tick cannot make the strategy open a fresh position mid-flatten.
  const shouldFlattenBacktest = action === "stop" && deployment.strategy_mode === "BACKTEST";

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
    } catch (err) {
      console.error(`[SymbolControl] Resolve on ${action} failed:`, err.message);
      await Deployment.updateOne(
        { _id: deployment._id },
        { $set: { "symbol_control.last_resolve_error": err.message } }
      );
    }
    // Reload clean Mongoose document after resolve (avoid Object.assign of plain objects)
    const refreshed = await Deployment.findById(deployment._id);
    if (refreshed) {
      await syncAllDeploymentsToRedis();
      await triggerBacktestIfNeeded(refreshed);
      return refreshed;
    }
  }

  await deployment.save();
  await syncAllDeploymentsToRedis();
  await triggerBacktestIfNeeded(deployment);

  // STOPPED is now published, so the strategy will not act on further ticks.
  // The stop itself has already committed, so a flatten failure is reported
  // rather than thrown — it must not turn a successful stop into an API error.
  if (shouldFlattenBacktest) {
    try {
      const flatten = await forceCloseOpenPositions(deployment, options.finalTick);
      if (flatten.stillOpen > 0) {
        console.error(
          `[Deployment] Stopped ${deployment._id} with ${flatten.stillOpen} OPEN position(s) that could not be flattened`
        );
      }
    } catch (err) {
      console.error(`[Deployment] Force-close failed after stopping ${deployment._id}: ${err.message}`);
    }
  }

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
  const trades = await Trade.find({ deployment_id: deployment._id }).sort({ created_at: 1 }).lean();

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

  // Realised comes from the trade walk, which only books P&L against closing
  // quantity and also covers deployments whose trades predate Position tracking.
  // Unrealised is open quantity only, so it can only come from OPEN positions.
  const openPositions = await Position.find({
    deployment_id: deployment._id,
    status: "OPEN",
  }).select("status realised_pnl unrealised_pnl");
  const realisedPnl = round2(totalPnL);
  const unrealisedPnl = sumOpenUnrealised(openPositions);

  return {
    deployment_id: deployment._id,
    current_status: deployment.current_status,
    total_trades: totalTrades,
    realised_pnl: realisedPnl,
    unrealised_pnl: unrealisedPnl,
    total_pnl: round2(realisedPnl + unrealisedPnl),
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
  const trades = await Trade.find(timeFilter).sort({ created_at: 1 }).lean();

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

  // Realised is the trade walk above: it books P&L against closing quantity only,
  // already respects the date window, and reconciles with gross_profit/gross_loss
  // and the tail of time_series by construction.
  const realisedPnl = round2(totalPnL);

  // Unrealised is a mark on currently open quantity, so it only belongs to a
  // window that extends to now. A bounded historical window reports realised only.
  const windowIncludesNow = !end || end.getTime() >= Date.now();
  const openPositions = windowIncludesNow
    ? await Position.find({ deployment_id: deployment._id, status: "OPEN" }).select(
        "status realised_pnl unrealised_pnl"
      )
    : [];
  const unrealisedPnl = sumOpenUnrealised(openPositions);

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
      realised_pnl: realisedPnl,
      unrealised_pnl: unrealisedPnl,
      total_pnl: round2(realisedPnl + unrealisedPnl),
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
};

export const syncAllDeploymentsToRedis = async ({ failLoud = false } = {}) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (failLoud) {
      throw new Error("REDIS_URL is required to sync deployments to Redis");
    }
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

      const deploymentIdStr = dep._id.toString();
      const stateEpoch = await ensureDeploymentStateEpoch(client, deploymentIdStr);
      // Legacy docs may lack timeframe — default to 1m so sync/smoke never aborts the whole Redis publish
      const timeframe = dep.timeframe || "1m";
      if (!dep.timeframe) {
        console.warn(`[Sync] RUNNING deployment ${deploymentIdStr} missing timeframe; defaulting to 1m`);
      }

      newKeysData[key].push({
        name: dep.strategy_id.strategy_name,
        isTest: isTest,
        timeframe,
        state_epoch: stateEpoch,
        account_id: dep.account_id.account_id || dep.account_id._id.toString(),
        user_symbol_id: dep.user_symbol_id ? dep.user_symbol_id.toString() : undefined,
        instrument_token: dep.instrument_token,
        symbol: dep.symbol,
        strategy_id: dep.strategy_id._id.toString(),
        deployment_id: deploymentIdStr,
        user_id: dep.user_id.toString(),
        strategy_mode: dep.strategy_mode,
        is_internal_broker: dep.account_id.broker_id ? dep.account_id.broker_id.is_internal : false,
        use_full_amount: dep.use_full_amount || false,
        lot_size: Number(dep.lot_size) > 0 ? Number(dep.lot_size) : undefined,
        no_of_lots: Number(dep.no_of_lots) >= 1 ? Number(dep.no_of_lots) : 1,
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

      // Sync account balance to Redis (namespaced by deploymentId for backtest mode to prevent cross-deployment collision)
      const accountId = dep.account_id.account_id || dep.account_id._id.toString();
      const balanceKey = isBacktest ? `account_balance:${deploymentIdStr}` : `account_balance:${accountId}`;
      const balanceData = { balance: dep.account_id.current_balance };
      try {
        if (typeof client.json?.set === 'function') {
          await client.json.set(balanceKey, '.', balanceData);
        } else {
          await client.set(balanceKey, JSON.stringify(balanceData));
        }
        console.log(`[Sync] Synced account balance for key ${balanceKey} to Redis: ${dep.account_id.current_balance}`);
      } catch (err) {
        console.error(`[Sync] Failed to sync account balance for key ${balanceKey} to Redis: ${err.message}`);
        if (failLoud) {
          throw err;
        }
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

    // Clean up stale account balance keys and liquidity sweep keys for deleted accounts and deployments
    const allAccounts = await Account.find({}, { _id: 1, account_id: 1 }).lean();
    const allDeployments = await Deployment.find({}, { _id: 1 }).lean();
    const validAccountIds = new Set();
    for (const acc of allAccounts) {
      if (acc._id) validAccountIds.add(acc._id.toString());
      if (acc.account_id) validAccountIds.add(acc.account_id.toString());
    }
    for (const dep of allDeployments) {
      if (dep._id) validAccountIds.add(dep._id.toString());
    }

    const existingBalanceKeys = await client.keys("account_balance:*");
    for (const key of existingBalanceKeys) {
      const accId = key.replace("account_balance:", "");
      if (!validAccountIds.has(accId)) {
        await client.del(key);
        console.log(`Deleted stale account balance Redis key: ${key}`);
      }
    }

    const existingSweepKeys = await client.keys("liquidity_sweep:open:*");
    for (const key of existingSweepKeys) {
      const accId = key.replace("liquidity_sweep:open:", "");
      if (!validAccountIds.has(accId)) {
        await client.del(key);
        console.log(`Deleted stale liquidity sweep open Redis key: ${key}`);
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
    if (failLoud) {
      throw error;
    }
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
    if (failLoud) {
      throw err;
    }
  }
};

export const getDeploymentCandles = async (userId, id, timeframe) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  const symbol = deployment.symbol;
  const date = deployment.backtest_date || new Date().toISOString().slice(0, 10);
  // Prefer explicit request TF, else deployment's configured candle timeframe
  const resolvedTf = normalizeTimeframe(timeframe || deployment.timeframe || "1m");

  return await getSymbolCandles(symbol, date, resolvedTf);
};
