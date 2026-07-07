import Deployment from "../models/deployment.js";
import Trade from "../models/trade.js";
import Ledger from "../models/ledger.js";
import Account from "../models/account.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";
import { createClient } from "redis";

const USER_UPDATABLE_FIELDS = ["deployment_name", "notes", "backtest_date", "backtest_speed"];

const triggerBacktestIfNeeded = (deployment) => {
  if (deployment.strategy_mode === "BACKTEST" && deployment.current_status === "RUNNING") {
    const symbolName = deployment.symbol;
    const date = deployment.backtest_date || new Date().toISOString().slice(0, 10);
    const timeMs = (deployment.backtest_speed !== undefined && deployment.backtest_speed !== null) ? deployment.backtest_speed : 1000;
    const triggerUrl = `${process.env.BACKTEST_CLIENT_URL || "http://backtest-client"}/?symbolName=${encodeURIComponent(symbolName)}&date=${encodeURIComponent(date)}&time_ms=${timeMs}&deployment_id=${encodeURIComponent(deployment._id.toString())}`;
    console.log(`[Backtest] Triggering backtest client: ${triggerUrl}`);
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
    // 1. Delete trades and ledgers in MongoDB for this deployment
    const deletedTrades = await Trade.deleteMany({ deployment_id: deploymentId });
    const deletedLedgers = await Ledger.deleteMany({ deployment_id: deploymentId });
    console.log(`[Reset] Deleted ${deletedTrades.deletedCount} trades and ${deletedLedgers.deletedCount} ledgers for deployment ${deploymentId}`);

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

export const createDeployment = async (userId, deploymentData) => {
  const deployment = new Deployment({ ...deploymentData, user_id: userId });
  const result = await deployment.save();
  await resetBacktestDeployment(result);
  triggerBacktestIfNeeded(result);
  await syncAllDeploymentsToRedis();
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
  return await Deployment.findOne({ _id: id, user_id: userId });
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
  const result = await Deployment.findOneAndDelete({ _id: id, user_id: userId });
  await syncAllDeploymentsToRedis();
  return result;
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
    await resetBacktestDeployment(deployment);
  }
  if (action === "stop") {
    deployment.end_time = new Date();
  }

  await deployment.save();
  triggerBacktestIfNeeded(deployment);
  await syncAllDeploymentsToRedis();
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
    win_rate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) + "%" : "100.00%",
  };
};

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
        instrument_token: dep.instrument_token,
        symbol: dep.symbol,
        strategy_id: dep.strategy_id._id.toString(),
        deployment_id: dep._id.toString(),
        user_id: dep.user_id.toString(),
        strategy_mode: dep.strategy_mode,
        is_internal_broker: dep.account_id.broker_id ? dep.account_id.broker_id.is_internal : false,
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
};
