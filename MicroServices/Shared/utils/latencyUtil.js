
function calculateLatency(msg) {
    let serverTime = new Date().getTime();
    let msgTimeStamp = msg.fullFeed.marketFF.ltpc.ltt;
    let messageTime = parseInt(msgTimeStamp);
    let latency = serverTime - messageTime;
    return latency;
}

export {
    calculateLatency
}