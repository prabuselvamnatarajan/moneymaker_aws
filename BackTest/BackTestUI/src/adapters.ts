/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Account, Strategy, SymbolData, Transaction } from './types';

// Map backend Account to UI Account
export function mapAccount(backendAcc: any): Account {
  const initial = backendAcc.initial_balance || 0;
  const current = backendAcc.current_balance || 0;
  
  return {
    id: backendAcc._id || backendAcc.account_id,
    name: backendAcc.account_name || 'Unnamed Account',
    broker: backendAcc.broker_id?.name || (backendAcc.description ? parseBrokerFromDescription(backendAcc.description) : 'Cobra Trades'),
    balance: current,
    margin: Math.round(current * 0.7), // Assume 70% margin
    initialBalance: initial,
    pnl: parseFloat((current - initial).toFixed(2)),
    currency: 'INR',
    status: backendAcc.is_active ? 'connected' : 'disconnected',
    commissionType: backendAcc.commission_type || 'PERCENTAGE',
    commissionRate: backendAcc.commission_rate || 0,
    brokerObj: backendAcc.broker_id || undefined,
    accountType: backendAcc.account_type,
    brokerId: typeof backendAcc.broker_id === 'object' ? backendAcc.broker_id?._id : backendAcc.broker_id,
  };
}

// Map backend UserSymbol to UI SymbolData
export function mapSymbol(backendSym: any): SymbolData {
  const typeMap: Record<string, string> = {
    'EQUITY': 'equity',
    'CRYPTO': 'crypto',
    'FOREX': 'forex',
    'INDEX': 'index',
  };
  const instClass = backendSym.instrument_class || 'EQUITY';
  const mappedType = typeMap[instClass.toUpperCase()] || 'equity';

  return {
    ticker: backendSym.symbol || 'UNKNOWN',
    name: backendSym.symbol_name || getSymbolName(backendSym.symbol),
    exchange: backendSym.exchange || 'NSE',
    lastPrice: 100.0, // Default fallback price
    change24h: 0.0,
    volume24h: 100000,
    instrumentType: mappedType as any,
    instrumentToken: backendSym.instrument_token || '',
    description: backendSym.description || '',
    instrumentClass: instClass,
  };
}

// Map backend Trade to UI Transaction
export function mapTrade(backendTrade: any): Transaction & { deployment_id?: string } {
  const qty = backendTrade.quantity || 0;
  const prc = backendTrade.price || 0;
  
  return {
    id: backendTrade.trade_id || backendTrade._id,
    timestamp: backendTrade.execution_time || backendTrade.created_at || new Date().toISOString(),
    type: backendTrade.type_of_order === 'SELL' ? 'SELL' : 'BUY',
    symbol: backendTrade.symbol || 'UNKNOWN',
    // strategyId maps to deployment_id (UI "strategies" = deployments)
    // If deployment_id is present, prefer it; fall back to strategy_id
    strategyId: backendTrade.deployment_id || backendTrade.strategy_id,
    accountId: backendTrade.account_id,
    quantity: qty,
    price: prc,
    fee: backendTrade.commission !== undefined ? backendTrade.commission : parseFloat((qty * prc * 0.0005).toFixed(2)),
    status: backendTrade.status === 'CANCELLED' ? 'CANCELLED' : backendTrade.status === 'PENDING' ? 'PENDING' : 'EXECUTED',
    tradeId: backendTrade.trade_id || backendTrade._id,
    orderId: backendTrade.trade_id || backendTrade._id,
    filledQty: qty,
    avgPrice: prc,
    notes: 'System executed trade.',
    flagged: false,
    events: [
      { time: backendTrade.created_at, message: `Trade processed: ${backendTrade.type_of_order} ${qty} @ ${prc}`, type: 'info' }
    ],
    transactionType: 'TRADE',
    changeInBalance: backendTrade.type_of_order === 'SELL' ? (qty * prc) : -(qty * prc),
    openingBalance: 0,
    closingBalance: 0,
    // Pass through deployment_id for downstream patching (e.g. GlobalTransactionsView)
    deployment_id: backendTrade.deployment_id,
  };
}


// Map backend Ledger to UI Transaction
export function mapLedger(backendLedger: any): Transaction {
  const accountId = backendLedger.account_id?._id || backendLedger.account_id;
  // Use deployment_id as strategyId because in this UI "strategies" are deployments.
  // strategy_id in the ledger points to the Strategy definition doc (different collection),
  // while deployment_id matches what is loaded into the UI `strategies` state.
  const strategyId = backendLedger.deployment_id?._id || backendLedger.deployment_id
    || backendLedger.strategy_id?._id || backendLedger.strategy_id || '';
  const quantity = backendLedger.quantity || backendLedger.trade_id?.quantity || 0;
  const price = backendLedger.price || backendLedger.trade_id?.price || 0;
  const fee = backendLedger.trade_id?.commission || 0;
  const isSell = backendLedger.order_type === 'SELL' || backendLedger.trade_id?.type_of_order === 'SELL';
  
  return {
    id: backendLedger._id,
    timestamp: backendLedger.created_on || new Date().toISOString(),
    type: backendLedger.transaction_type === 'TRADE' ? (isSell ? 'SELL' : 'BUY') : undefined,
    symbol: backendLedger.symbol || '',
    strategyId,
    accountId,
    quantity,
    price,
    fee,
    status: 'EXECUTED',
    tradeId: backendLedger.trade_id?._id || backendLedger.trade_id || undefined,
    orderId: backendLedger.trade_id?._id || backendLedger.trade_id || undefined,
    filledQty: quantity,
    avgPrice: price,
    notes: backendLedger.description || (backendLedger.transaction_type === 'TRADE' ? 'System executed trade.' : 'Ledger movement'),
    flagged: false,
    events: [
      { time: backendLedger.created_on, message: backendLedger.description || `Processed: ${backendLedger.transaction_type}`, type: 'info' }
    ],
    transactionType: backendLedger.transaction_type || 'TRADE',
    changeInBalance: backendLedger.change_in_balance || 0,
    openingBalance: backendLedger.opening_balance || 0,
    closingBalance: backendLedger.closing_balance || 0,
  };
}

// Map backend Deployment + Metrics to UI Strategy
export function mapDeployment(backendDeployment: any, metrics: any = null): Strategy {
  const winRateStr = metrics?.win_rate || '100.0%';
  const winRateVal = parseFloat(winRateStr.replace('%', ''));

  let mappedStatus: 'active' | 'paused' | 'stopped' = 'stopped';
  if (backendDeployment.current_status === 'RUNNING') {
    mappedStatus = 'active';
  } else if (backendDeployment.current_status === 'PAUSED') {
    mappedStatus = 'paused';
  }

  return {
    id: backendDeployment._id || backendDeployment.deployment_id,
    name: backendDeployment.deployment_name || 'Algorithmic Strategy',
    mode: backendDeployment.strategy_mode?.toLowerCase() === 'live'
      ? 'live'
      : backendDeployment.strategy_mode?.toLowerCase() === 'paper'
      ? 'paper'
      : 'backtest',
    status: mappedStatus,
    pnl: metrics?.total_pnl || 0,
    totalTrades: metrics?.total_trades || 0,
    winRate: isNaN(winRateVal) ? 100.0 : winRateVal,
    lastDeployTime: backendDeployment.start_time || backendDeployment.created_at || new Date().toISOString(),
    openPositions: 0, // Fallback placeholder
    symbols: [backendDeployment.symbol || 'NSE_INDEX|Nifty 50'],
    description: backendDeployment.notes || 'Algorithmic deployment workload.',
    accountId: backendDeployment.account_id ? String(backendDeployment.account_id) : undefined,
  };
}

// Helpers
function parseBrokerFromDescription(desc: string): string {
  // If description has broker information e.g. "broker:Interactive Brokers", extract it
  if (desc.startsWith('broker:')) {
    const parts = desc.split('|');
    return parts[0].substring(7);
  }
  return desc || 'Simulation Broker';
}

function getSymbolName(ticker: string): string {
  const map: Record<string, string> = {
    'NSE_INDEX|Nifty 50': 'Nifty 50',
    'NSE_INDEX|Nifty Bank': 'Nifty Bank',
    'BTC/USD': 'Bitcoin / US Dollar',
    'AAPL': 'Apple Inc.',
    'EUR/USD': 'Euro / US Dollar',
    'TSLA': 'Tesla Inc.',
    'NVDA': 'NVIDIA Corporation',
  };
  return map[ticker] || ticker;
}
