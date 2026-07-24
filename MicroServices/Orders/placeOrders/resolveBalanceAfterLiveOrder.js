/**
 * Resolve Redis account balance after a live broker fill.
 * Live availableMargin can read 0 right after SELL (CNC lag); never wipe a
 * positive ledger closing_balance with that zero reading or use_full_amount stalls.
 */
export function resolveBalanceAfterLiveOrder(ledgerClosingBalance, liveAvailableMargin) {
    const ledgerNum = ledgerClosingBalance != null ? Number(ledgerClosingBalance) : null;
    const liveNum = liveAvailableMargin != null ? Number(liveAvailableMargin) : null;

    if (liveNum != null && !Number.isNaN(liveNum) && liveNum > 0) {
        return { balanceToStore: liveNum, balanceSource: 'live_available_margin' };
    }
    if (ledgerNum != null && !Number.isNaN(ledgerNum)) {
        return {
            balanceToStore: ledgerNum,
            balanceSource: liveNum === 0 ? 'ledger_kept_over_zero_live' : 'ledger_closing_balance',
        };
    }
    if (liveNum != null && !Number.isNaN(liveNum)) {
        return { balanceToStore: liveNum, balanceSource: 'live_available_margin_zero' };
    }
    return { balanceToStore: null, balanceSource: null };
}
