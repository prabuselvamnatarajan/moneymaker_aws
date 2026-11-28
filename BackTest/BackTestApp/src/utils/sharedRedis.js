import { createClient } from "redis";

/**
 * One long-lived Redis client for best-effort reads on request paths (for
 * example the symbol latency lookup). It is never connected per request.
 *
 * - It always has an `error` listener. node-redis emits `error` on every failed
 *   connect or reconnect, and an EventEmitter with no listener throws, which
 *   would take BackTestApp down during a Redis blip.
 * - The offline queue is disabled, so a command sent while Redis is down fails
 *   at once instead of hanging the HTTP request until Redis comes back.
 * - `getReadySharedRedisClient()` returns null until the client is connected,
 *   so callers simply skip the optional enrichment.
 */

const ERROR_LOG_INTERVAL_MS = 30_000;

let factory = createClient;
let client = null;
let lastErrorLogAt = 0;

function logError(err) {
  const now = Date.now();
  if (now - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
  lastErrorLogAt = now;
  console.error(`[SharedRedis] ${err?.message || err}`);
}

/** Creates the client on first use and starts connecting in the background. */
export function getSharedRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = factory({ url, disableOfflineQueue: true });
    client.on("error", logError);
    client.connect().catch(logError);
  }
  return client;
}

/** The shared client when it is connected, otherwise null (never waits). */
export function getReadySharedRedisClient() {
  const c = getSharedRedisClient();
  return c && c.isReady ? c : null;
}

export async function closeSharedRedisClient() {
  const c = client;
  client = null;
  if (c) await c.quit().catch(() => c.disconnect?.().catch(() => {}));
}

/** Test hook: swap the client factory and drop any existing client. */
export function __setRedisClientFactoryForTests(nextFactory) {
  factory = nextFactory || createClient;
  client = null;
  lastErrorLogAt = 0;
}
