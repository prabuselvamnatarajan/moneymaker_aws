/** Normalize Upstox instrument keys for comparison (full key vs suffix after "|"). */
export function instrumentTokenSuffix(token: string): string {
  if (!token) return '';
  return token.includes('|') ? token.split('|')[1] : token;
}

export function instrumentTokenPrefix(token: string): string | null {
  if (!token || !token.includes('|')) return null;
  return token.split('|')[0];
}

/**
 * Match instrument tokens across formats.
 * When both sides include an exchange prefix (e.g. NSE_EQ|...), prefixes must match.
 * Suffix-only matching is allowed only when one side lacks a prefix.
 */
export function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const prefixA = instrumentTokenPrefix(a);
  const prefixB = instrumentTokenPrefix(b);
  const suffixA = instrumentTokenSuffix(a);
  const suffixB = instrumentTokenSuffix(b);

  if (prefixA && prefixB) {
    return prefixA === prefixB && suffixA === suffixB;
  }
  return suffixA === suffixB;
}

export interface LiveQuote {
  lastPrice?: number;
  change24h?: number;
  volume24h?: number;
}

const MAX_LIVE_QUOTES = 500;

/** Store a live quote under both the full token, its suffix, and optional symbol/ticker for O(1) lookup. */
export function applyLiveQuote(
  quotes: Record<string, LiveQuote>,
  instrumentToken: string,
  patch: LiveQuote,
  symbol?: string
): Record<string, LiveQuote> {
  const merge = (prev: LiveQuote | undefined): LiveQuote => ({
    ...prev,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined && v !== null)
    ),
  });

  const next: Record<string, LiveQuote> = { ...quotes };
  next[instrumentToken] = merge(quotes[instrumentToken]);

  const suffix = instrumentTokenSuffix(instrumentToken);
  if (suffix && suffix !== instrumentToken) {
    next[suffix] = merge(quotes[suffix]);
  }

  if (symbol && symbol !== instrumentToken && symbol !== suffix) {
    next[symbol] = merge(quotes[symbol]);
  }

  const keys = Object.keys(next);
  if (keys.length > MAX_LIVE_QUOTES) {
    // Drop oldest-ish keys (insertion order) that are not the ones we just wrote.
    const protectedKeys = new Set([instrumentToken, suffix, symbol].filter(Boolean) as string[]);
    let toRemove = keys.length - MAX_LIVE_QUOTES;
    for (const key of keys) {
      if (toRemove <= 0) break;
      if (protectedKeys.has(key)) continue;
      delete next[key];
      toRemove -= 1;
    }
  }

  return next;
}

export function getLiveQuote(
  quotes: Record<string, LiveQuote>,
  instrumentToken: string,
  fallbackKey?: string
): LiveQuote | undefined {
  if (instrumentToken) {
    if (quotes[instrumentToken]) return quotes[instrumentToken];
    const suffix = instrumentTokenSuffix(instrumentToken);
    if (suffix !== instrumentToken && quotes[suffix]) {
      return quotes[suffix];
    }
  }
  if (fallbackKey && quotes[fallbackKey]) {
    return quotes[fallbackKey];
  }
  return undefined;
}

/** Keep only quotes that still match active symbol tokens. */
export function pruneLiveQuotes(
  quotes: Record<string, LiveQuote>,
  keepTokens: string[]
): Record<string, LiveQuote> {
  const keep = new Set<string>();
  for (const token of keepTokens) {
    if (!token) continue;
    keep.add(token);
    const suffix = instrumentTokenSuffix(token);
    if (suffix) keep.add(suffix);
  }
  const next: Record<string, LiveQuote> = {};
  for (const [key, value] of Object.entries(quotes)) {
    if (keep.has(key)) next[key] = value;
  }
  return next;
}
