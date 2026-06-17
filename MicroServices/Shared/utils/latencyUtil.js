
function calculateLatency(key, msg) {
    let FF_chooser = key.includes("INDEX") ? "indexFF" : "marketFF";
    let serverTime = new Date().getTime();
    let msgTimeStamp = msg.fullFeed[FF_chooser].ltpc.ltt;
    let messageTime = parseInt(msgTimeStamp);
    let latency = serverTime - messageTime;
    return latency;
}

export {
    calculateLatency
}