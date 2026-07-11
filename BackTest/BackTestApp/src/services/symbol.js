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

export const createSymbol = async (userId, symbolData) => {
  const symbol = new UserSymbol({ ...symbolData, user_id: userId });
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
  const result = await UserSymbol.findOneAndDelete(query);
  if (result && result.is_active) {
    await publishSymbolUpdate({
      action: "unsubscribe",
      instrument_token: result.instrument_token,
      userId
    });
  }
  await syncAllActiveSymbolsToRedis();
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
  const { symbol: underlyingSymbol, range_count, range_option, option_type, expiry } = bulkData;

  if (!underlyingSymbol || !range_option || !option_type) {
    throw new Error("underlyingSymbol, range_option, and option_type are required");
  }

  // 1. Fetch LTP for the underlying symbol
  const ltpServiceUrl = process.env.GET_LTP_SERVICE_URL || "http://get-ltp:80";
  let ltp;
  try {
    const ltpResponse = await fetch(`${ltpServiceUrl}/?symbol=${encodeURIComponent(underlyingSymbol)}&userId=${userId}`);
    if (!ltpResponse.ok) {
      throw new Error(`LTP service returned status ${ltpResponse.status}`);
    }
    const ltpData = await ltpResponse.json();
    if (ltpData.status !== "success" || !ltpData.data) {
      throw new Error("Invalid response format from LTP service");
    }
    const entries = Object.entries(ltpData.data);
    if (entries.length === 0) {
      throw new Error(`Symbol ${underlyingSymbol} not found in LTP service`);
    }
    const val = entries[0][1];
    ltp = val.last_price || val.lastPrice;
  } catch (err) {
    console.error(`Failed to fetch LTP for ${underlyingSymbol}:`, err.message);
    throw new Error(`Failed to fetch LTP for underlying symbol: ${err.message}`);
  }

  if (!ltp) {
    throw new Error(`Could not retrieve LTP for underlying symbol ${underlyingSymbol}`);
  }

  // 2. Fetch Option Chain for the underlying symbol
  const optionChainServiceUrl = process.env.GET_OPTION_CHAIN_SERVICE_URL || "http://get-put-call-option-chain:80";
  let chainItems;
  try {
    const optionChainResponse = await fetch(`${optionChainServiceUrl}/?symbol=${encodeURIComponent(underlyingSymbol)}&expiry=${encodeURIComponent(expiry || 'current_week')}&userId=${userId}`);
    if (!optionChainResponse.ok) {
      throw new Error(`Option chain service returned status ${optionChainResponse.status}`);
    }
    const optionChainData = await optionChainResponse.json();
    if (optionChainData.status !== "success" || !Array.isArray(optionChainData.data)) {
      throw new Error("Invalid response format from Option Chain service");
    }
    chainItems = optionChainData.data.map(item => ({
      expiry: item.expiry,
      strike_price: item.strikePrice !== undefined ? item.strikePrice : item.strike_price,
      underlying_key: item.underlyingKey !== undefined ? item.underlyingKey : item.underlying_key,
      underlying_spot_price: item.underlyingSpotPrice !== undefined ? item.underlyingSpotPrice : item.underlying_spot_price,
      call_options: item.callOptions ? {
        instrument_key: item.callOptions.instrumentKey !== undefined ? item.callOptions.instrumentKey : item.callOptions.instrument_key,
        market_data: item.callOptions.marketData,
        option_greeks: item.callOptions.optionGreeks
      } : item.call_options,
      put_options: item.putOptions ? {
        instrument_key: item.putOptions.instrumentKey !== undefined ? item.putOptions.instrumentKey : item.putOptions.instrument_key,
        market_data: item.putOptions.marketData,
        option_greeks: item.putOptions.optionGreeks
      } : item.put_options
    }));
  } catch (err) {
    console.error(`Failed to fetch Option Chain for ${underlyingSymbol}:`, err.message);
    throw new Error(`Failed to fetch Option Chain for underlying symbol: ${err.message}`);
  }

  if (chainItems.length === 0) {
    throw new Error(`No option contracts found in the option chain for ${underlyingSymbol}`);
  }

  // 3. Find the ATM strike price: closest to the underlying LTP
  let atmStrike = null;
  let minDiff = Infinity;
  for (const item of chainItems) {
    const diff = Math.abs(item.strike_price - ltp);
    if (diff < minDiff) {
      minDiff = diff;
      atmStrike = item.strike_price;
    }
  }

  // 4. Categorize options relative to ATM
  const sortedItems = [...chainItems].sort((a, b) => a.strike_price - b.strike_price);

  // Split into ITM and OTM groups relative to atmStrike
  // CE ITM: strike < atmStrike, OTM: strike > atmStrike
  // PE ITM: strike > atmStrike, OTM: strike < atmStrike
  const ceItmItems = sortedItems.filter(item => item.strike_price < atmStrike && item.call_options).reverse(); // closest to ATM first
  const ceOtmItems = sortedItems.filter(item => item.strike_price > atmStrike && item.call_options); // closest to ATM first
  const peItmItems = sortedItems.filter(item => item.strike_price > atmStrike && item.put_options); // closest to ATM first
  const peOtmItems = sortedItems.filter(item => item.strike_price < atmStrike && item.put_options).reverse(); // closest to ATM first

  const atmItem = sortedItems.find(item => item.strike_price === atmStrike);

  let selectedStrikesCE = [];
  let selectedStrikesPE = [];

  const count = parseInt(range_count, 10) || 1;

  if (range_option === "ATM") {
    if (atmItem) {
      if (atmItem.call_options) selectedStrikesCE.push(atmItem);
      if (atmItem.put_options) selectedStrikesPE.push(atmItem);
    }
  } else if (range_option === "ITM") {
    selectedStrikesCE = ceItmItems.slice(0, count);
    selectedStrikesPE = peItmItems.slice(0, count);
  } else if (range_option === "OTM") {
    selectedStrikesCE = ceOtmItems.slice(0, count);
    selectedStrikesPE = peOtmItems.slice(0, count);
  } else if (range_option === "ALL") {
    if (atmItem) {
      if (atmItem.call_options) selectedStrikesCE.push(atmItem);
      if (atmItem.put_options) selectedStrikesPE.push(atmItem);
    }
    selectedStrikesCE = [...selectedStrikesCE, ...ceItmItems.slice(0, count), ...ceOtmItems.slice(0, count)];
    selectedStrikesPE = [...selectedStrikesPE, ...peItmItems.slice(0, count), ...peOtmItems.slice(0, count)];
  }

  const addedSymbols = [];

  const formatSymbolName = (underlying, strike, type, expiry) => {
    const cleanUnderlying = underlying.includes("|") ? underlying.split("|")[1] : underlying;
    const cleanExpiry = expiry && expiry.includes("T") ? expiry.split("T")[0] : expiry;
    return `${cleanUnderlying} ${cleanExpiry || ""} ${strike} ${type}`;
  };

  const saveSymbol = async (optionData, strikePrice, expiryDate, typeLabel) => {
    const instrumentToken = optionData.instrument_key;
    let existing = await UserSymbol.findOne({ user_id: userId, instrument_token: instrumentToken });
    if (!existing) {
      const symbol_name = formatSymbolName(underlyingSymbol, strikePrice, typeLabel, expiryDate);
      const newSym = new UserSymbol({
        user_id: userId,
        instrument_token: instrumentToken,
        symbol: instrumentToken,
        symbol_name: symbol_name,
        exchange: "NFO",
        instrument_class: "OPTION",
        description: `${underlyingSymbol} ${typeLabel} Option Contract`,
        is_active: true
      });
      const saved = await newSym.save();
      addedSymbols.push(saved);
      if (saved.is_active) {
        try {
          await publishSymbolUpdate({
            action: "subscribe",
            instrument_token: saved.instrument_token,
            userId
          });
        } catch (e) {
          console.error("Failed to publish symbol subscribe for bulk symbol:", e);
        }
      }
    }
  };

  if (option_type === "Call" || option_type === "Both") {
    for (const item of selectedStrikesCE) {
      if (item.call_options) {
        await saveSymbol(item.call_options, item.strike_price, item.expiry, "CE");
      }
    }
  }

  if (option_type === "Put" || option_type === "Both") {
    for (const item of selectedStrikesPE) {
      if (item.put_options) {
        await saveSymbol(item.put_options, item.strike_price, item.expiry, "PE");
      }
    }
  }

  await syncAllActiveSymbolsToRedis();

  return {
    message: `Successfully processed bulk symbol addition. Added ${addedSymbols.length} new symbols.`,
    data: addedSymbols
  };
};

export const getSymbolCandles = async (symbol, date, timeframe = "1m") => {
  const sanitizedSymbol = String(symbol).replace(/[^a-zA-Z0-9-_]/g, '_');
  let filePath = path.join(process.cwd(), "..", "exportedData", date, `${sanitizedSymbol}.json`);
  
  try {
    await fs.access(filePath);
  } catch (err) {
    const fallbackPath = path.join("/shared", "exportedData", date, `${sanitizedSymbol}.json`);
    try {
      await fs.access(fallbackPath);
      filePath = fallbackPath;
    } catch (fallbackErr) {
      // Keep original filePath to let standard error handling capture it
    }
  }
  
  let data;
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    data = JSON.parse(fileContent);
  } catch (err) {
    console.error(`[Candles Service] Error reading or parsing file ${filePath}:`, err.message);
    return {
      symbol,
      date,
      timeframe,
      data: []
    };
  }

  if (!Array.isArray(data)) {
    return { symbol, date, timeframe, data: [] };
  }

  let intervalMs = 60 * 1000;
  if (timeframe === "5m") {
    intervalMs = 5 * 60 * 1000;
  } else if (timeframe === "15m") {
    intervalMs = 15 * 60 * 1000;
  }

  const buckets = {};

  for (const tick of data) {
    if (!tick.timestamp || !tick.fullFeed || !tick.fullFeed.marketFF || !tick.fullFeed.marketFF.ltpc) {
      continue;
    }
    const ltp = tick.fullFeed.marketFF.ltpc.ltp;
    if (ltp === undefined || ltp === null) {
      continue;
    }

    const timestampMs = new Date(tick.timestamp).getTime();
    if (isNaN(timestampMs)) {
      continue;
    }

    const bucketTimeMs = Math.floor(timestampMs / intervalMs) * intervalMs;
    const volume = tick.fullFeed.marketFF.ltpc.ltq ? parseFloat(tick.fullFeed.marketFF.ltpc.ltq) : 0;

    if (!buckets[bucketTimeMs]) {
      buckets[bucketTimeMs] = {
        time: Math.floor(bucketTimeMs / 1000),
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: volume,
        ticksCount: 1,
        firstTickTime: timestampMs,
        lastTickTime: timestampMs
      };
    } else {
      const b = buckets[bucketTimeMs];
      if (timestampMs < b.firstTickTime) {
        b.open = ltp;
        b.firstTickTime = timestampMs;
      }
      if (timestampMs > b.lastTickTime) {
        b.close = ltp;
        b.lastTickTime = timestampMs;
      }
      if (ltp > b.high) b.high = ltp;
      if (ltp < b.low) b.low = ltp;
      b.volume += volume;
      b.ticksCount += 1;
    }
  }

  const candles = Object.keys(buckets)
    .map(key => {
      const b = buckets[key];
      return {
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: Math.round(b.volume)
      };
    })
    .sort((a, b) => a.time - b.time);

  return {
    symbol,
    date,
    timeframe,
    data: candles
  };
};



