import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import UserSymbol from "../models/userSymbol.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { createClient } from "redis";


export const publishSymbolUpdate = async (payload) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("⚠️ REDIS_URL not set, skipping symbol update publishing");
    return;
  }
  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();
    await client.publish("symbol_updates", JSON.stringify(payload));
    console.log(`[Symbol Service] Published symbol update:`, payload);
  } catch (err) {
    console.error(`[Symbol Service] Failed to publish symbol update:`, err.message);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
};

const ALLOWED_INSTRUMENT_CLASSES = new Set(["EQUITY", "INDEX", "OPTION"]);

export const createSymbol = async (userId, symbolData) => {
  const instrumentClass = String(symbolData.instrument_class || "EQUITY").toUpperCase();
  if (!ALLOWED_INSTRUMENT_CLASSES.has(instrumentClass)) {
    throw new Error("instrument_class must be EQUITY, INDEX, or OPTION");
  }
  if (instrumentClass === "EQUITY" || instrumentClass === "INDEX") {
    const diff = Number(symbolData.strike_price_diff);
    if (!(diff > 0)) {
      throw new Error("strike_price_diff is required for EQUITY/INDEX symbols and must be > 0");
    }
  }
  if (instrumentClass === "OPTION") {
    const lotSize = Number(symbolData.lot_size);
    if (!(lotSize > 0)) {
      throw new Error("lot_size is required for OPTION symbols and must be > 0");
    }
  }

  const symbol = new UserSymbol({
    ...symbolData,
    instrument_class: instrumentClass,
    user_id: userId,
  });
  const result = await symbol.save();
  if (result.is_active) {
    await publishSymbolUpdate({
      action: "subscribe",
      instrument_token: result.instrument_token,
      userId
    });
  }
  await syncAllActiveSymbolsToRedis();
  return result;
};

export const getAllSymbols = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "added_at",
    dateField: "added_at",
    searchFields: ["symbol", "exchange", "symbol_name"]
  });

  filter.user_id = userId;

  // Support instrument_class filter (e.g. ?instrument_class=EQUITY)
  if (queryParams.instrument_class) {
    filter.instrument_class = queryParams.instrument_class.toUpperCase();
  }

  const items = await UserSymbol.find(filter)
  const items = await UserSymbol.find(filter).lean()
    .sort(sort)
    .skip(skip)
    .limit(limit);

  const total = await UserSymbol.countDocuments(filter);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
};

export const getSymbolById = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [
      ...(isObjectId ? [{ _id: id }] : []),
      { user_symbol_id: id }
    ]
  };
  return await UserSymbol.findOne(query);
};

export const updateSymbol = async (userId, id, updateData) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [
      ...(isObjectId ? [{ _id: id }] : []),
      { user_symbol_id: id }
    ]
  };

  const oldSymbol = await UserSymbol.findOne(query);
  if (!oldSymbol) return null;

  const nextClass = String(updateData.instrument_class || oldSymbol.instrument_class || "EQUITY").toUpperCase();
  if (updateData.instrument_class !== undefined && !ALLOWED_INSTRUMENT_CLASSES.has(nextClass)) {
    throw new Error("instrument_class must be EQUITY, INDEX, or OPTION");
  }
  if (nextClass === "EQUITY" || nextClass === "INDEX") {
    const diff =
      updateData.strike_price_diff !== undefined
        ? Number(updateData.strike_price_diff)
        : Number(oldSymbol.strike_price_diff);
    if (!(diff > 0)) {
      throw new Error("strike_price_diff is required for EQUITY/INDEX symbols and must be > 0");
    }
  }
  if (nextClass === "OPTION") {
    const lotSize =
      updateData.lot_size !== undefined
        ? Number(updateData.lot_size)
        : Number(oldSymbol.lot_size);
    if (!(lotSize > 0)) {
      throw new Error("lot_size is required for OPTION symbols and must be > 0");
    }
  }

  const result = await UserSymbol.findOneAndUpdate(query, updateData, {
    new: true,
    runValidators: true
  });

  if (result) {
    const wasActive = oldSymbol.is_active;
    const isActive = result.is_active;
    const oldToken = oldSymbol.instrument_token;
    const newToken = result.instrument_token;

    if (wasActive && !isActive) {
      await publishSymbolUpdate({
        action: "unsubscribe",
        instrument_token: oldToken,
        userId
      });
    } else if (!wasActive && isActive) {
      await publishSymbolUpdate({
        action: "subscribe",
        instrument_token: newToken,
        userId
      });
    } else if (wasActive && isActive) {
      if (oldToken !== newToken) {
        await publishSymbolUpdate({
          action: "update",
          old_instrument_token: oldToken,
          instrument_token: newToken,
          userId
        });
      }
    }
    await syncAllActiveSymbolsToRedis();
  }

  return result;
};

export const deleteSymbol = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [
      ...(isObjectId ? [{ _id: id }] : []),
      { user_symbol_id: id }
    ]
  };
  const result = await UserSymbol.findOne(query);
  if (!result) return null;

  const Deployment = mongoose.model("Deployment");
  const Position = mongoose.model("Position");
  const Trade = mongoose.model("Trade");
  const Ledger = mongoose.model("Ledger");

  // Step 1: Find all deployments linked to this symbol (owned by this user, including controlled deployments)
  const deployments = await Deployment.find({
    user_id: userId,
    $or: [
      { user_symbol_id: result._id },
      { "symbol_control.underlying_user_symbol_id": result._id }
    ]
  }, { _id: 1 });
  const deploymentIds = deployments.map(d => d._id);

  // Step 2: Cascade-delete all child records by deployment_id (most records only reference deployment)
  if (deploymentIds.length > 0) {
    await Trade.deleteMany({ deployment_id: { $in: deploymentIds }, user_id: userId });
    await Position.deleteMany({ deployment_id: { $in: deploymentIds }, user_id: userId });
    await Ledger.deleteMany({ deployment_id: { $in: deploymentIds }, user_id: userId });
  }

  // Step 3: Delete any orphaned records that reference the symbol directly (without a deployment)
  await Trade.deleteMany({ user_symbol_id: result._id, user_id: userId });
  await Position.deleteMany({ user_symbol_id: result._id, user_id: userId });
  await Ledger.deleteMany({ user_symbol_id: result._id, user_id: userId });

  // Step 4: Delete all deployments for this symbol (direct or controlled underlying)
  await Deployment.deleteMany({
    user_id: userId,
    $or: [
      { user_symbol_id: result._id },
      { "symbol_control.underlying_user_symbol_id": result._id }
    ]
  });

  // Step 5: Delete the symbol itself
  await UserSymbol.deleteOne({ _id: result._id });

  console.log(`[Symbol Service] Cascading delete complete for symbol ${result.symbol}: removed ${deploymentIds.length} deployments and all associated trades/positions/ledgers.`);

  // Clean runtime keys for all child deployments in Redis
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && deploymentIds.length > 0) {
    let client;
    try {
      client = createClient({ url: redisUrl });
      await client.connect();
      for (const depId of deploymentIds) {
        const depIdStr = depId.toString();
        let cursor = 0;
        const pattern = `*${depIdStr}*`;
        do {
          const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
          cursor = reply.cursor;
          const keys = reply.keys || [];
          if (keys.length > 0) {
            await client.del(keys);
          }
        } while (cursor !== 0);
      }
    } catch (err) {
      console.error("[Symbol Service] Failed to clean Redis keys on symbol deletion:", err.message);
    } finally {
      if (client) {
        await client.disconnect().catch(() => {});
      }
    }
  }

  if (result.is_active) {
    await publishSymbolUpdate({
      action: "unsubscribe",
      instrument_token: result.instrument_token,
      userId
    });
  }
  await syncAllActiveSymbolsToRedis();

  try {
    const { syncAllDeploymentsToRedis } = await import("./deployment.js");
    await syncAllDeploymentsToRedis();
  } catch (err) {
    console.error("Failed to sync deployments to Redis after symbol deletion:", err.message);
  }

  return result;
};

export const syncAllActiveSymbolsToRedis = async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("⚠️ REDIS_URL not set, skipping active symbols sync to Redis");
    return;
  }
  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();

    const activeSymbols = await UserSymbol.find({ is_active: true });
    const activeTokens = activeSymbols.map(s => s.instrument_token).filter(Boolean);

    await client.del("symbols:active");
    if (activeTokens.length > 0) {
      await client.sAdd("symbols:active", activeTokens);
      console.log(`[Symbol Service] Synced ${activeTokens.length} active symbols to Redis`);
    } else {
      console.log("[Symbol Service] No active symbols to sync to Redis");
    }
  } catch (err) {
    console.error("[Symbol Service] Failed to sync active symbols to Redis:", err.message);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
};

export const bulkCreateSymbols = async (userId, bulkData) => {
  const { symbol: underlyingSymbol, range_count, range_option, option_type, expiry, lot_size } = bulkData;
  const lotSize = Number(lot_size);
  if (!(lotSize > 0)) {
    throw new Error("lot_size is required for bulk OPTION create and must be > 0");
  }

  const {
    resolveBulkOptionSelections,
    ensureOptionUserSymbol,
  } = await import("./optionSymbolResolver.js");

  let selection;
  try {
    selection = await resolveBulkOptionSelections({
      userId,
      underlyingSymbol,
      range_count,
      range_option,
      option_type,
      expiry,
    });
  } catch (err) {
    console.error(`Failed bulk option resolve for ${underlyingSymbol}:`, err.message);
    throw err;
  }

  const { selectedStrikesCE, selectedStrikesPE } = selection;
  const addedSymbols = [];

  const saveSelected = async (item, typeLabel) => {
    const optionData = typeLabel === "CE" ? item.call_options : item.put_options;
    if (!optionData) return;
    const before = await UserSymbol.findOne({
      user_id: userId,
      instrument_token: optionData.instrument_key,
    });
    const ensured = await ensureOptionUserSymbol(
      userId,
      underlyingSymbol,
      optionData,
      item.strike_price,
      item.expiry,
      typeLabel,
      lotSize
    );
    if (!before) {
      const created = await UserSymbol.findById(ensured.user_symbol_id);
      if (created) addedSymbols.push(created);
    } else {
      // Existing record may have received an updated lot_size
      const updated = await UserSymbol.findById(ensured.user_symbol_id);
      if (updated) addedSymbols.push(updated);
    }
  };

  if (option_type === "Call" || option_type === "Both") {
    for (const item of selectedStrikesCE) {
      await saveSelected(item, "CE");
    }
  }

  if (option_type === "Put" || option_type === "Both") {
    for (const item of selectedStrikesPE) {
      await saveSelected(item, "PE");
    }
  }

  await syncAllActiveSymbolsToRedis();
  return {
    message: `Added ${addedSymbols.length} option symbol(s)`,
    data: addedSymbols,
  };
};

const resolveExportedDataDir = () => {
  // Canonical layout: {SHARED_DIR}/exportedData/{yyyy-MM-dd}/{symbol}.json
  if (process.env.EXPORTED_DATA_DIR) return process.env.EXPORTED_DATA_DIR;
  const sharedRoot = process.env.SHARED_DIR || process.env.EXPORT_VOLUME_PATH || "/shared";
  return path.join(sharedRoot, "exportedData");
};

export const getSymbolCandles = async (symbol, date, timeframe = "1m") => {
  const sanitizedSymbol = String(symbol).replace(/[^a-zA-Z0-9-_]/g, '_');
  const filePath = path.join(resolveExportedDataDir(), date, `${sanitizedSymbol}.json`);

  let data;
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    data = JSON.parse(fileContent);
  } catch (err) {
    const error = new Error(
      `Candle data not found or unreadable for ${symbol} on ${date} at ${filePath}: ${err.message}`
    );
    error.statusCode = err.code === "ENOENT" ? 404 : 500;
    throw error;
  }

  if (!Array.isArray(data)) {
    const error = new Error(
      `Candle data at ${filePath} must be a JSON array (got ${data === null ? "null" : typeof data})`
    );
    error.statusCode = 500;
    throw error;
  }

  const intervalMs = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000 }[timeframe] || 60000;
  const IST_OFFSET_MS = 19800000; // +5:30 in ms
  const OPEN_MS  = (9 * 60 + 15) * 60000;   // 09:15 in ms-of-day
  const CLOSE_MS = (15 * 60 + 30) * 60000;   // 15:30 in ms-of-day
  const buckets = {};

  // Sort ticks by exchange LTT ascending so open = first price, close = last price
  const validTicks = [];
  for (const tick of data) {
    const feed = tick.fullFeed?.marketFF || tick.fullFeed?.indexFF;
    if (!feed?.ltpc) continue;

    const ltpc = feed.ltpc;
    const ltp = ltpc.ltp;
    if (ltp === undefined || ltp === null) continue;

    // ltt is inside ltpc (tick.fullFeed.[marketFF/indexFF].ltpc.ltt) as ms epoch from exchange
    // Fallback to server-stored tick.timestamp if ltt is absent
    let tickTimeMs;
    if (ltpc.ltt) {
      tickTimeMs = parseInt(ltpc.ltt, 10);
    } else if (tick.timestamp) {
      tickTimeMs = new Date(tick.timestamp).getTime();
    } else {
      continue;
    }
    if (isNaN(tickTimeMs) || tickTimeMs <= 0) continue;

    // Verify the ltt date (in IST) matches the requested date.
    // Pre-market ticks carry stale ltt from the previous session's close;
    // they would pass the market-hours window check but belong to yesterday.
    const istDateStr = new Date(tickTimeMs + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (istDateStr !== date) continue;

    // Filter to NSE market hours only: 9:15 AM – 3:30 PM IST
    const istMsOfDay = (tickTimeMs + IST_OFFSET_MS) % 86400000;
    if (istMsOfDay < OPEN_MS || istMsOfDay > CLOSE_MS) continue;

    validTicks.push({ tickTimeMs, ltp, volume: parseFloat(ltpc.ltq || 0) });
  }

  // Sort ascending by exchange time — guarantees open = first, close = last
  validTicks.sort((a, b) => a.tickTimeMs - b.tickTimeMs);

  for (const { tickTimeMs, ltp, volume } of validTicks) {
    const bucketTimeMs = Math.floor(tickTimeMs / intervalMs) * intervalMs;

    if (!buckets[bucketTimeMs]) {
      buckets[bucketTimeMs] = { time: Math.floor(bucketTimeMs / 1000), open: ltp, high: ltp, low: ltp, close: ltp, volume };
    } else {
      const b = buckets[bucketTimeMs];
      b.close = ltp;
      b.high = Math.max(b.high, ltp);
      b.low = Math.min(b.low, ltp);
      b.volume += volume;
    }
  }

  const candleData = Object.values(buckets).sort((a, b) => a.time - b.time);
  return { symbol, date, timeframe, data: candleData };
};

export const getAvailableBacktestDates = async () => {
  const dates = new Set();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const exportedDataDir = resolveExportedDataDir();

  try {
    const files = await fs.readdir(exportedDataDir);
    for (const file of files) {
      if (!dateRegex.test(file)) continue;
      try {
        const stat = await fs.stat(path.join(exportedDataDir, file));
        if (stat.isDirectory()) dates.add(file);
      } catch (e) {}
    }
  } catch (err) {
    const error = new Error(
      `Exported data directory not readable at ${exportedDataDir}: ${err.message}`
    );
    error.statusCode = err.code === "ENOENT" ? 404 : 500;
    throw error;
  }

  return Array.from(dates).sort((a, b) => b.localeCompare(a));
};
