export function isMissingRequiredOrderFields(body = {}) {
    return !body.instrument_token
        || body.price === undefined
        || body.quantity === undefined
        || !body.transaction_type
        || !body.strategy_details
        || !body.strategy_details.user_id;
}
