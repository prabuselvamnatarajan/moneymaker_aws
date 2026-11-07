function sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function extractFeed(item) {
    if (!item || typeof item !== 'object') return null;
    return item.fullFeed?.marketFF
        || item.fullFeed?.indexFF
        || item.marketFF
        || item.indexFF
        || item.feed
        || null;
}

function extractLtp(item) {
    if (!item || typeof item !== 'object') return null;
    const raw = extractFeed(item)?.ltpc?.ltp ?? item.ltpc?.ltp ?? item.ltp ?? null;
    if (raw == null || raw === '') return null;
    const ltp = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(ltp) && ltp > 0 ? ltp : null;
}

function extractTickTimeMs(item) {
    if (!item || typeof item !== 'object') return null;
    const ltt = extractFeed(item)?.ltpc?.ltt ?? item.ltpc?.ltt;
    if (ltt != null && ltt !== '') {
        const ms = typeof ltt === 'number' ? ltt : parseInt(ltt, 10);
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    if (item.timestamp) {
        const ms = new Date(item.timestamp).getTime();
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return null;
}

module.exports = {
    sanitize,
    extractFeed,
    extractLtp,
    extractTickTimeMs,
};
