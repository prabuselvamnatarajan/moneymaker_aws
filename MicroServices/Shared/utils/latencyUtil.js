
function calculateLatency(key, msg) {
    try {
        const feed = msg?.fullFeed?.marketFF
            || msg?.fullFeed?.indexFF
            || msg?.marketFF
            || msg?.indexFF
            || (msg?.ltpc ? { ltpc: msg.ltpc } : null)
            || (msg?.firstLevelWithGreeks?.ltpc ? msg.firstLevelWithGreeks : null);

        const msgTimeStamp = feed?.ltpc?.ltt;
        if (msgTimeStamp == null) {
            return null;
        }

        const messageTime = parseInt(msgTimeStamp, 10);
        if (!Number.isFinite(messageTime)) {
            return null;
        }

        return new Date().getTime() - messageTime;
    } catch (err) {
        return null;
    }
}

export {
    calculateLatency
};
