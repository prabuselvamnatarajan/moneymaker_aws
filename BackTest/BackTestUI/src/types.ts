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
  brokerObj?: Broker;
  accountType?: 'LIVE' | 'PAPER' | 'SIMULATION';
  brokerId?: string;
}

export interface Strategy {
  id: string;
  name: string;
  mode: 'live' | 'paper' | 'backtest';
  status: 'active' | 'paused' | 'stopped';
  pnl: number;
  totalTrades: number;
  winRate: number; // e.g., 64.5 for 64.5%
  lastDeployTime: string;
  openPositions: number;
  symbols: string[]; // Tickers associated with this strategy
  description: string;
  accountId?: string;
  backtestDate?: string;
  backtestSpeed?: number;
}

export interface SymbolData {
  ticker: string;
  name: string;
  exchange: string;
  lastPrice: number;
  change24h: number; // percentage
  volume24h: number;
  instrumentType: 'crypto' | 'equity' | 'forex' | 'index';
  instrumentToken?: string;
  description?: string;
  instrumentClass?: string;
}

export interface AuditTrailEvent {
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface Broker {
  _id: string;
  name: string;
  is_internal: boolean;
  user_id?: string;
  external_broker_id?: string;
  credentials?: {
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
  };
  access_token?: string;
  created_at: string;
}

export interface ExternalBroker {
  _id: string;
  external_broker_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface Transaction {
  id: string; // Internal system UUID or Trade/Execution ID
  timestamp: string; // ISO 8601 string
  type?: 'BUY' | 'SELL';
  symbol: string;
  strategyId: string;
  accountId: string;
  quantity?: number;
  price?: number;
  fee: number;
  status?: 'EXECUTED' | 'PENDING' | 'CANCELLED';
  tradeId?: string; // Outer broker-reported execution ID
  orderId?: string;
  filledQty?: number;
  avgPrice?: number;
  notes: string;
  flagged: boolean;
  events: AuditTrailEvent[];
  transactionType?: 'TRADE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  changeInBalance?: number;
  openingBalance?: number;
  closingBalance?: number;
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
  | 'profile'
  | 'brokers-list'
  | 'strategy-templates';
