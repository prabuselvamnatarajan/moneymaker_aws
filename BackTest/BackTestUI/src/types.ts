/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Account {
  id: string;
  name: string;
  broker: string;
  balance: number;
  margin: number;
  initialBalance: number;
  pnl: number;
  currency: string;
  status: 'connected' | 'disconnected';
  commissionType?: 'PERCENTAGE' | 'FLAT';
  commissionRate?: number;
}

export interface Strategy {
  id: string;
  name: string;
  mode: 'live' | 'backtest';
  status: 'active' | 'paused' | 'stopped';
  pnl: number;
  totalTrades: number;
  winRate: number; // e.g., 64.5 for 64.5%
  lastDeployTime: string;
  openPositions: number;
  symbols: string[]; // Tickers associated with this strategy
  description: string;
  accountId?: string;
}

export interface SymbolData {
  ticker: string;
  name: string;
  exchange: string;
  lastPrice: number;
  change24h: number; // percentage
  volume24h: number;
  instrumentType: 'crypto' | 'equity' | 'forex' | 'index';
}

export interface AuditTrailEvent {
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface Transaction {
  id: string; // Internal system UUID or Trade/Execution ID
  timestamp: string; // ISO 8601 string
  type: 'BUY' | 'SELL';
  symbol: string;
  strategyId: string;
  accountId: string;
  quantity: number;
  price: number;
  fee: number;
  status: 'EXECUTED' | 'PENDING' | 'CANCELLED';
  tradeId: string; // Outer broker-reported execution ID
  orderId: string;
  filledQty: number;
  avgPrice: number;
  notes: string;
  flagged: boolean;
  events: AuditTrailEvent[];
}

export interface ColumnPreference {
  id: string;
  label: string;
  visible: boolean;
}

export interface TransactionFilters {
  search: string;
  accounts: string[];
  strategies: string[];
  symbols: string[];
  types: ('BUY' | 'SELL')[];
  statuses: ('EXECUTED' | 'PENDING' | 'CANCELLED')[];
  dateRange: 'today' | '7d' | '30d' | 'all' | 'custom';
  customFrom: string;
  customTo: string;
}

export type ViewScreen = 
  | 'dashboard' 
  | 'transactions' 
  | 'accounts-list' 
  | 'strategies-list' 
  | 'symbols-list' 
  | 'strategy-detail' 
  | 'account-detail' 
  | 'symbol-detail'
  | 'profile';
