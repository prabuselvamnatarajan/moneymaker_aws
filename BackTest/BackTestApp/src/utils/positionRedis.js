import { createClient } from "redis";

function openSymbolKey(symbol) {
  return `position:open:${String(symbol || "").toUpperCase()}`;
}

function liveKey(positionId) {
  return `position:live:${positionId}`;
}

async function withRedis(fn) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }
  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();
    return await fn(client);
  } catch (err) {
    console.error(`[PositionRedis] ${err.message}`);
    return null;
  } finally {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  }
}

async function setJson(client, key, value) {
  if (typeof client.json?.set === "function") {
    await client.json.set(key, ".", value);
  } else {
    await client.set(key, JSON.stringify(value));
  }
}

async function getJson(client, key) {
  if (typeof client.json?.get === "function") {
    return await client.json.get(key);
  }
  const raw = await client.get(key);
  return raw ? JSON.parse(raw) : null;
}

export function buildLiveCache(position) {
  return {
    positionMongoId: position._id?.toString?.() || String(position._id),
    positionId: position.position_id || position._id?.toString?.(),
    symbol: String(position.symbol || "").toUpperCase(),
    entryPrice: position.average_entry_price || 0,
    direction: position.direction,
    openSize: position.open_size || 0,
    maxUp: position.max_up || 0,
    maxDown: position.max_down || 0,
    maxUpPct: position.max_up_pct || 0,
    maxDownPct: position.max_down_pct || 0,
    unrealisedPnl: position.unrealised_pnl || 0,
    lastLtp: position.last_ltp || 0,
  };
}

export async function syncOpenPositionToRedis(position) {
  if (!position || position.status !== "OPEN" || !(position.open_size > 0) || position.strategy_mode === "BACKTEST") {
    return;
  }
  const id = position._id.toString();
  const symbol = String(position.symbol || "").toUpperCase();
  const cache = buildLiveCache(position);

  await withRedis(async (client) => {
    await setJson(client, liveKey(id), cache);
    await client.sAdd(openSymbolKey(symbol), id);
  });
}

export async function removeOpenPositionFromRedis(position) {
  if (!position) return;
  const id = position._id.toString();
  const symbol = String(position.symbol || "").toUpperCase();

  await withRedis(async (client) => {
    await client.del(liveKey(id));
    await client.sRem(openSymbolKey(symbol), id);
  });
}

export async function readLiveCache(positionMongoId) {
  return withRedis(async (client) => getJson(client, liveKey(positionMongoId)));
}

export {
  openSymbolKey,
  liveKey,
  withRedis,
  setJson,
  getJson,
};
