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

export async function fetchAuthorizedWebSocketUrl(accessToken, httpClient) {
    if (!accessToken) {
        throw new Error('Access token is required to authorize Upstox market data feed');
    }

    const client = httpClient || (await import('axios')).default;
    const endpoints = [
        'https://api.upstox.com/v3/feed/market-data-feed/authorize',
        'https://api.upstox.com/v2/feed/market-data-feed/authorize',
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
        try {
            const response = await client.get(endpoint, {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                timeout: 10000,
            });

            const data = response?.data?.data || response?.data;
            const redirectUri = data?.authorized_redirect_uri || data?.authorizedRedirectUri;
            if (redirectUri) {
                return redirectUri;
            }
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            if (status === 401) {
                throw err;
            }
        }
    }

    if (lastError) {
        throw lastError;
    }
    throw new Error('Upstox market-data-feed/authorize did not return an authorized redirect URI');
}
