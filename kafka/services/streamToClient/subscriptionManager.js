export function resolveChannel(msg, livePrefix = 'live', backtestPrefix = 'backtest') {
    if (!msg || !msg.action || !msg.mode || !msg.symbol) {
        return null;
    }
    const mode = msg.mode === 'live' ? livePrefix : backtestPrefix;
    return `${mode}:${msg.symbol}`;
}

export function createSubscriptionManager(options = {}) {
    const { onChannelNeeded, onChannelUnused } = options;
    const sockets = new Map();
    const socketSubscriptions = new Map();
    const channelSubscriptions = new Map();

    function addClient(socketId, ws) {
        sockets.set(socketId, ws);
        socketSubscriptions.set(socketId, new Set());
    }

    async function subscribe(socketId, channel) {
        let isNewChannel = false;
        if (!channelSubscriptions.has(channel)) {
            channelSubscriptions.set(channel, new Set());
            isNewChannel = true;
        }
        channelSubscriptions.get(channel).add(socketId);
        socketSubscriptions.get(socketId)?.add(channel);

        if (isNewChannel && onChannelNeeded) {
            await onChannelNeeded(channel);
        }
        return { isNewChannel };
    }

    async function unsubscribe(socketId, channel) {
        channelSubscriptions.get(channel)?.delete(socketId);
        socketSubscriptions.get(socketId)?.delete(channel);
        let wasPruned = false;
        if (channelSubscriptions.get(channel)?.size === 0) {
            channelSubscriptions.delete(channel);
            wasPruned = true;
            if (onChannelUnused) {
                await onChannelUnused(channel);
            }
        }
        return { wasPruned };
    }

    async function removeClient(socketId) {
        const channels = Array.from(socketSubscriptions.get(socketId) || []);
        for (const ch of channels) {
            channelSubscriptions.get(ch)?.delete(socketId);
            if (channelSubscriptions.get(ch)?.size === 0) {
                channelSubscriptions.delete(ch);
                if (onChannelUnused) {
                    await onChannelUnused(ch);
                }
            }
        }
        socketSubscriptions.delete(socketId);
        sockets.delete(socketId);
    }

    return {
        sockets,
        socketSubscriptions,
        channelSubscriptions,
        addClient,
        subscribe,
        unsubscribe,
        removeClient,
    };
}
