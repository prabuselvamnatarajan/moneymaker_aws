import mongoose from "mongoose";
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
      instrument_token: result.instrument_token
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
        instrument_token: oldToken
      });
    } else if (!wasActive && isActive) {
      await publishSymbolUpdate({
        action: "subscribe",
        instrument_token: newToken
      });
    } else if (wasActive && isActive) {
      if (oldToken !== newToken) {
        await publishSymbolUpdate({
          action: "update",
          old_instrument_token: oldToken,
          instrument_token: newToken
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
      instrument_token: result.instrument_token
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


