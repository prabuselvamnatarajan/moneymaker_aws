export function isMissingRequiredOrderFields(body = {}) {
    return !body.instrument_token
        || body.price === undefined
        || body.quantity === undefined
        || !body.transaction_type
        || !body.strategy_details
        || !body.strategy_details.user_id;
}

/**
 * Every order must carry the caller's client_order_id. It is the ledger's
 * idempotency key, so a retried request must reuse it; the gateway never
 * invents one (a fresh id per retry would book the trade twice).
 */
export function isMissingClientOrderId(body = {}) {
    const id = body.client_order_id || (body.strategy_details && body.strategy_details.client_order_id);
    return typeof id !== 'string' || id.trim() === '';
}
