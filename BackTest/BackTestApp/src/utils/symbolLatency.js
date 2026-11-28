/**
 * Feed latency cached by websocketService (symbol:latency:<symbol or token>,
 * 5-minute TTL), attached to symbol API responses. Best effort: any Redis
 * problem leaves the documents unchanged.
 */

export const LATENCY_KEY_PREFIX = "symbol:latency:";

/** Keys to try for one symbol document, most specific first. */
export function latencyKeysFor(doc = {}) {
  const keys = [];
  if (doc.symbol) keys.push(`${LATENCY_KEY_PREFIX}${doc.symbol}`);
  if (doc.instrument_token) {
    const token = String(doc.instrument_token);
    const clean = token.includes("|") ? token.split("|")[1] || token : token;
    const tokenKey = `${LATENCY_KEY_PREFIX}${clean}`;
    if (!keys.includes(tokenKey)) keys.push(tokenKey);
  }
  return keys;
}

/**
 * Sets `latency_ms` on each lean document that has a cached value. Uses one
 * MGET for the whole page instead of one or two GETs per symbol.
 */
export async function attachCachedLatency(docs, client) {
  if (!client || !Array.isArray(docs) || docs.length === 0) return docs;
  const perDoc = docs.map((doc) => latencyKeysFor(doc));
  const allKeys = [...new Set(perDoc.flat())];
  if (allKeys.length === 0) return docs;

  let values;
  try {
    values = await client.mGet(allKeys);
  } catch {
    return docs;
  }
  const byKey = new Map(allKeys.map((key, i) => [key, values?.[i]]));

  docs.forEach((doc, i) => {
    for (const key of perDoc[i]) {
      const raw = byKey.get(key);
      if (raw == null) continue;
      const ms = Number(raw);
      if (Number.isFinite(ms)) {
        doc.latency_ms = ms;
        break;
      }
    }
  });
  return docs;
}
