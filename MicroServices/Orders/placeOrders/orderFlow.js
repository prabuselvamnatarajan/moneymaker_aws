/**
 * Order flow for the placeOrders gateway. Dependencies are injected so the
 * broker / ledger ordering and failure handling can be unit tested.
 */
export function closingBalanceOf(ledgerResponse) {
    const { data: { closing_balance } = {} } = ledgerResponse || {};
    return closing_balance === undefined ? null : closing_balance;
}

export function createOrderFlow(deps) {
    /**
     * Live order with an external broker. The broker is always called first and
     * the ledger is written only after the broker accepts, so a rejection never
     * leaves a ledger trade (or a ledger-written Redis balance) behind.
     * The response is sent only after the broker call, the ledger write and the
     * Redis balance update have all finished, so the strategy's next tick always
     * sees the post-order balance.
     */
    async function handleLiveBrokerOrder(body, strategy_details, isBacktest) {
        const { getAccessTokenFromRedis, placeOrders, recordTradeInLedger, getLiveAccountBalance, setAccountBalanceToRedis, buildBrokerOrderPayload, resolveBalanceAfterLiveOrder } = deps;
        // Validate the Upstox payload before anything else; throws 400 on bad input.
        const brokerPayload = JSON.stringify(buildBrokerOrderPayload(body));
        // Throws 401 if token missing/expired — no silent fallback.
        const access_token = await getAccessTokenFromRedis(strategy_details.user_id);

        const brokerResult = await placeOrders(access_token, brokerPayload);

        let ledgerResponse = null;
        try {
            ledgerResponse = await recordTradeInLedger(body);
        } catch (err) {
            console.error('CRITICAL: broker accepted the order but the ledger write failed after retries:', err.message || err);
        }

        const ledgerClosingBalance = closingBalanceOf(ledgerResponse);

        let liveBalance = null;
        try {
            liveBalance = await getLiveAccountBalance(strategy_details.user_id);
        } catch (err) {
            console.error('Failed to fetch live account balance after order (keeping ledger balance):', err.message || err);
        }

        const { balanceToStore, balanceSource } = resolveBalanceAfterLiveOrder(ledgerClosingBalance, liveBalance);
        if (balanceToStore !== null) {
            await setAccountBalanceToRedis(strategy_details.account_id, balanceToStore, strategy_details.deployment_id, isBacktest);
            if (balanceSource === 'ledger_kept_over_zero_live') {
                console.warn(
                    `Keeping ledger balance ${ledgerClosingBalance} for account ${strategy_details.account_id}; live availableMargin was ${liveBalance}`
                );
            }
        }

        return brokerResult;
    }

    /** PAPER and BACKTEST orders: ledger only, never the external broker. */
    async function handleInternalOrder(body, strategy_details, isBacktest) {
        const { recordTradeInLedger, setAccountBalanceToRedis } = deps;
        const ledgerResponse = await recordTradeInLedger(body);
        const closing_balance = closingBalanceOf(ledgerResponse);
        if (closing_balance !== null) {
            await setAccountBalanceToRedis(strategy_details.account_id, closing_balance, strategy_details.deployment_id, isBacktest);
        } else {
            console.warn('⚠️ Warning: Received invalid closing balance from BackTestApp:', closing_balance);
        }
        return isBacktest
            ? 'Backtest Mode: Order recorded internally; not sent to a broker.'
            : 'Paper Mode: Order recorded internally; not sent to a broker.';
    }

    return { handleLiveBrokerOrder, handleInternalOrder };
}
