
function calculateLatency(key, msg) {
    const ff = msg?.fullFeed?.marketFF || msg?.fullFeed?.indexFF;
    if (!ff?.ltpc?.ltt) return 0;
    let serverTime = new Date().getTime();
    let msgTimeStamp = ff.ltpc.ltt;
    let messageTime = parseInt(msgTimeStamp);
    if (isNaN(messageTime)) return 0;
    let latency = serverTime - messageTime;
    return latency;
}

export {
    calculateLatency
}