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
    broker: backendAcc.description ? parseBrokerFromDescription(backendAcc.description) : 'Simulation Broker',
    balance: current,
    margin: Math.round(current * 0.7), // Assume 70% margin
    initialBalance: initial,
    pnl: parseFloat((current - initial).toFixed(2)),
    currency: 'INR',
    status: backendAcc.is_active ? 'connected' : 'disconnected',
  };
}

// Map backend UserSymbol to UI SymbolData
export function mapSymbol(backendSym: any): SymbolData {
  return {
    ticker: backendSym.symbol || 'UNKNOWN',
    name: getSymbolName(backendSym.symbol),
    exchange: backendSym.exchange || 'NSE',
    lastPrice: 100.0, // Default fallback price
    change24h: 0.0,
    volume24h: 100000,
    instrumentType: backendSym.exchange === 'NSE' || backendSym.exchange === 'BSE' ? 'equity' : 'crypto',
  };
}

// Map backend Trade to UI Transaction
export function mapTrade(backendTrade: any): Transaction {
  const qty = backendTrade.quantity || 0;
  const prc = backendTrade.price || 0;
  
  return {
    id: backendTrade.trade_id || backendTrade._id,
    timestamp: backendTrade.execution_time || backendTrade.created_at || new Date().toISOString(),
    type: backendTrade.type_of_order === 'SELL' ? 'SELL' : 'BUY',
    symbol: backendTrade.symbol || 'UNKNOWN',
    strategyId: backendTrade.strategy_id,
    accountId: backendTrade.account_id,
    quantity: qty,
    price: prc,
    fee: parseFloat((qty * prc * 0.0005).toFixed(2)), // Estimate 0.05% fee
    status: backendTrade.status === 'CANCELLED' ? 'CANCELLED' : backendTrade.status === 'PENDING' ? 'PENDING' : 'EXECUTED',
    tradeId: backendTrade.trade_id || backendTrade._id,
    orderId: backendTrade.trade_id || backendTrade._id,
    filledQty: qty,
    avgPrice: prc,
    notes: 'System executed trade.',
    flagged: false,
    events: [
      { time: backendTrade.created_at, message: `Trade processed: ${backendTrade.type_of_order} ${qty} @ ${prc}`, type: 'info' }
    ]
  };
}

// Map backend Deployment + Metrics to UI Strategy
export function mapDeployment(backendDeployment: any, metrics: any = null): Strategy {
  const winRateStr = metrics?.win_rate || '50.0%';
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
    mode: backendDeployment.strategy_mode?.toLowerCase() === 'live' ? 'live' : 'backtest',
    status: mappedStatus,
    pnl: metrics?.total_pnl || 0,
    totalTrades: metrics?.total_trades || 0,
    winRate: isNaN(winRateVal) ? 50.0 : winRateVal,
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
