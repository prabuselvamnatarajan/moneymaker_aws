export function normalizeSymbolsInput(symbolInput) {
    if (!symbolInput) return [];
    const symbolArray = Array.isArray(symbolInput) ? symbolInput : [symbolInput];
    return symbolArray.filter(Boolean);
}

export function buildSubscriptionFrame(method, instrumentKeys) {
    return {
        guid: 'someguid',
        method, // 'sub' or 'unsub'
        data: {
            ...(method === 'sub' ? { mode: 'full' } : {}),
            instrumentKeys,
        },
    };
}

export function calculateBackoffDelay(reconnectAttempt, maxDelay = 60000) {
    return Math.min(1000 * Math.pow(2, reconnectAttempt), maxDelay);
}

export function unionSymbols(deploymentSymbols = [], activeSymbolsList = []) {
    return Array.from(new Set([...(deploymentSymbols || []), ...(activeSymbolsList || [])].filter(Boolean)));
}

export function processSymbolUpdateEvent(message, options = {}) {
    const payload = typeof message === 'string' ? JSON.parse(message) : message;
    const { action, instrument_token, old_instrument_token, userId } = payload || {};
    const { state, onSubscribe, onUnsubscribe } = options;

    if (state) {
        if (action === 'subscribe' && instrument_token) {
            state.activeSymbols?.add?.(instrument_token);
        } else if (action === 'unsubscribe' && instrument_token) {
            state.activeSymbols?.delete?.(instrument_token);
            state.subscribedSymbols?.delete?.(instrument_token);
        } else if (action === 'update') {
            if (old_instrument_token) {
                state.activeSymbols?.delete?.(old_instrument_token);
                state.subscribedSymbols?.delete?.(old_instrument_token);
            }
            if (instrument_token) {
                state.activeSymbols?.add?.(instrument_token);
            }
        }
    }

    if (action === 'subscribe' && instrument_token) {
        onSubscribe?.([instrument_token], userId);
    } else if (action === 'unsubscribe' && instrument_token) {
        onUnsubscribe?.([instrument_token]);
    } else if (action === 'update') {
        if (old_instrument_token) {
            onUnsubscribe?.([old_instrument_token]);
        }
        if (instrument_token) {
            onSubscribe?.([instrument_token], userId);
        }
    }

    return payload;
}
