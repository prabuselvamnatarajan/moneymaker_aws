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
     * Live order with an external broker. The response is sent only after the
     * broker call, the ledger write and the Redis balance update have all
     * finished, so the strategy's next tick always sees the post-order balance.
     */
    async function handleLiveBrokerOrder(body, strategy_details, isBacktest) {
        const { getAccessTokenFromRedis, placeOrders, recordTradeInLedger, getLiveAccountBalance, setAccountBalanceToRedis, buildBrokerOrderPayload, resolveLedgerMode, resolveBalanceAfterLiveOrder } = deps;
        // Throws 401 if token missing/expired — no silent fallback.
        const access_token = await getAccessTokenFromRedis(strategy_details.user_id);
        const brokerPayload = JSON.stringify(buildBrokerOrderPayload(body));
        const mode = resolveLedgerMode();

        let brokerResult;
        let ledgerResponse = null;
        let ledgerError = null;

        if (mode === 'sequential') {
            brokerResult = await placeOrders(access_token, brokerPayload);
            try {
                ledgerResponse = await recordTradeInLedger(body);
            } catch (err) {
                ledgerError = err;
            }
        } else {
            const [broker, ledger] = await Promise.allSettled([
                placeOrders(access_token, brokerPayload),
                recordTradeInLedger(body),
            ]);
            if (ledger.status === 'fulfilled') {
                ledgerResponse = ledger.value;
            } else {
                ledgerError = ledger.reason;
            }
            if (broker.status === 'rejected') {
                if (ledgerResponse) {
                    console.error(
                        `CRITICAL: broker rejected order ${body.client_order_id || strategy_details.client_order_id} ` +
                        `(deployment ${strategy_details.deployment_id}) but the ledger already recorded it. ` +
                        'Ledger position and balance now overstate the real account until reconciled.'
                    );
                }
                throw broker.reason;
            }
            brokerResult = broker.value;
        }

        if (ledgerError) {
            console.error('CRITICAL: broker accepted the order but the ledger write failed after retries:', ledgerError.message || ledgerError);
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

    /** Paper, backtest and internal-broker orders: ledger only. */
    async function handleInternalOrder(body, strategy_details, isBacktest, isInternalBroker) {
        const { recordTradeInLedger, setAccountBalanceToRedis } = deps;
        const ledgerResponse = await recordTradeInLedger(body);
        const closing_balance = closingBalanceOf(ledgerResponse);
        if (closing_balance !== null) {
            await setAccountBalanceToRedis(strategy_details.account_id, closing_balance, strategy_details.deployment_id, isBacktest);
        } else {
            console.warn('⚠️ Warning: Received invalid closing balance from BackTestApp:', closing_balance);
        }
        return isInternalBroker
            ? 'Internal Broker Mode: Order recorded internally.'
            : 'Test Mode: Order not placed with external broker.';
    }

    return { handleLiveBrokerOrder, handleInternalOrder };
}
