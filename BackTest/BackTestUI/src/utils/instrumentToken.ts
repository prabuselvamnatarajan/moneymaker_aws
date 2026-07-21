/** Normalize Upstox instrument keys for comparison (full key vs suffix after "|"). */
export function instrumentTokenSuffix(token: string): string {
  if (!token) return '';
  return token.includes('|') ? token.split('|')[1] : token;
}

export function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const suffixA = instrumentTokenSuffix(a);
  const suffixB = instrumentTokenSuffix(b);
  return suffixA === suffixB || a === suffixB || b === suffixA;
}

/** Store a live price under both the full token and its suffix for O(1) lookup. */
export function applyLivePrice(
  prices: Record<string, number>,
  instrumentToken: string,
  lastPrice: number
): Record<string, number> {
  const next = { ...prices, [instrumentToken]: lastPrice };
  const suffix = instrumentTokenSuffix(instrumentToken);
  if (suffix && suffix !== instrumentToken) {
    next[suffix] = lastPrice;
  }
  return next;
}

export function getLivePrice(
  prices: Record<string, number>,
  instrumentToken: string
): number | undefined {
  if (!instrumentToken) return undefined;
  if (prices[instrumentToken] !== undefined) return prices[instrumentToken];
  const suffix = instrumentTokenSuffix(instrumentToken);
  if (suffix !== instrumentToken && prices[suffix] !== undefined) {
    return prices[suffix];
  }
  return undefined;
}
