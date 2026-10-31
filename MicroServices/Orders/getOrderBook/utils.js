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
