export function validateLtpRequest(query) {
    const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
    if (!userId) {
        return { error: 'Bad Request: userId is required', status: 400 };
    }
    const symbol = typeof query?.symbol === 'string' ? query.symbol.trim() : '';
    if (!symbol) {
        return { error: 'Bad Request: symbol is required', status: 400 };
    }
    return { value: { userId, symbol }, status: 200, userId, symbol };
}

export function extractUpstoxErrorMessage(error) {
    try {
        const text = error?.response?.text || error?.text;
        if (text) {
            const parsed = JSON.parse(text);
            const first = parsed?.errors?.[0];
            if (first?.message) return first.message;
        }
    } catch {
        // ignore parse errors
    }
    return error?.message || 'Upstox API request failed';
}

export function handleApiCallbackError(error) {
    const status = error?.status || error?.statusCode;
    if (status === 401 || status === 403) {
        return {
            statusCode: 401,
            body: 'Unauthorized: Invalid or expired Upstox access token — re-authenticate via Brokers page.',
            invalidateToken: true,
        };
    }
    return {
        statusCode: 500,
        body: `Internal Server Error: ${extractUpstoxErrorMessage(error)}`,
        invalidateToken: false,
    };
}
