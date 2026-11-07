export function computeReferenceStrike(ltp, strikePriceDiff) {
    const diff = Number(strikePriceDiff);
    const price = Number(ltp);
    if (!(diff > 0) || !(price > 0)) return null;
    return Math.round(price / diff) * diff;
}

export function shouldTriggerResolve(dep, ltp, now, lastResolveAt, throttleMs = 5000) {
    const strikeDiff = Number(dep?.strike_price_diff);
    if (!(strikeDiff > 0)) return false;
    if (dep?.pending_resolve) return false;

    const referenceStrike = computeReferenceStrike(ltp, strikeDiff);
    if (referenceStrike == null) return false;

    if (dep?.last_resolved_strike != null && Number(dep.last_resolved_strike) === referenceStrike) {
        return false;
    }

    const last = lastResolveAt instanceof Map
        ? (lastResolveAt.get(dep?.deployment_id) || 0)
        : (lastResolveAt?.[dep?.deployment_id] || 0);

    if (now - last < throttleMs) {
        return false;
    }

    return true;
}
