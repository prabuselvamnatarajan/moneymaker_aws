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
    // node-redis surfaces post-connect socket failures as an 'error' event, which
    // is an uncaught exception (process exit) unless a listener is attached.
    client.on("error", (err) => console.error(`[PositionRedis] client error: ${err.message}`));
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
    lastTickAt: position.last_tick_at ? new Date(position.last_tick_at).getTime() : 0,
    strategyMode: position.strategy_mode || null,
    deploymentId: position.deployment_id?.toString?.() || position.deployment_id || null,
  };
}

export async function syncOpenPositionToRedis(position) {
  if (!position || position.status !== "OPEN" || !(position.open_size > 0)) {
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

/**
 * Bulk-remove live cache + open-symbol set membership for positions
 * (used by backtest reset before Mongo deleteMany).
 */
export async function purgePositionsFromRedis(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return;
  await withRedis(async (client) => {
    for (const position of positions) {
      if (!position?._id) continue;
      const id = position._id.toString();
      const symbol = String(position.symbol || "").toUpperCase();
      await client.del(liveKey(id)).catch(() => {});
      if (symbol) {
        await client.sRem(openSymbolKey(symbol), id).catch(() => {});
      }
    }
  });
}

export async function readLiveCache(positionMongoId) {
  return withRedis(async (client) => getJson(client, liveKey(positionMongoId)));
}

export async function setDeploymentCloseTime(deploymentId, closeTime) {
  if (!deploymentId) return;
  const timeMs = closeTime instanceof Date ? closeTime.getTime() : Number(closeTime);
  if (!Number.isFinite(timeMs)) return;
  await withRedis(async (client) => {
    await client.set(`deployment:close_time:${deploymentId}`, String(timeMs));
  });
}

export async function deleteDeploymentCloseTime(deploymentId) {
  if (!deploymentId) return;
  await withRedis(async (client) => {
    await client.del(`deployment:close_time:${deploymentId}`);
  });
}

export async function removePositionFromOpenSymbolSet(symbol, positionMongoId) {
  if (!symbol || !positionMongoId) return;
  const s = String(symbol).toUpperCase();
  const id = positionMongoId.toString();
  await withRedis(async (client) => {
    await client.sRem(openSymbolKey(s), id);
  });
}

export async function addPositionToOpenSymbolSet(symbol, positionMongoId) {
  if (!symbol || !positionMongoId) return;
  const s = String(symbol).toUpperCase();
  const id = positionMongoId.toString();
  await withRedis(async (client) => {
    await client.sAdd(openSymbolKey(s), id);
  });
}

export {
  openSymbolKey,
  liveKey,
  withRedis,
  setJson,
  getJson,
};

