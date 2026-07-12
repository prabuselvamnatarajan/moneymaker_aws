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
  useFullAmount?: boolean;
}

export interface SymbolData {
  id?: string;
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
  isActive?: boolean;
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
  token_status?: 'valid' | 'expired' | 'missing';
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
  | 'live-candlestick'
  | 'transactions' 
  | 'accounts-list' 
  | 'strategies-list' 
  | 'symbols-list' 
  | 'strategy-detail' 
  | 'account-detail' 
  | 'symbol-detail'
  | 'profile'
  | 'brokers-list'
  | 'strategy-templates'
  | 'deployment-analysis';

export interface DeploymentAnalysis {
  deployment_id: string;
  deployment_name: string;
  symbol: string;
  strategy_mode: string;
  time_range: {
    start: string | null;
    end: string | null;
  };
  metrics: {
    total_trades: number;
    total_pnl: number;
    gross_profit: number;
    gross_loss: number;
    profitability_factor: number | string;
    wins: number;
    losses: number;
    win_rate: string;
    max_drawdown: number;
    max_drawup: number;
  };
  time_series: Array<{
    timestamp: string;
    pnl: number;
    trade_id: string;
  }>;
  intraday_trades: Array<{
    timestamp: string;
    time_of_day: string; // HH:MM:SS format
    hour: number;
    minute: number;
    second: number;
    pnl: number;
    trade_id: string;
    type_of_order: string;
  }>;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  pnl: number;
  trade_id: string;
}

export interface IntradayTradeDataPoint {
  timestamp: string;
  time_of_day: string;
  hour: number;
  minute: number;
  second: number;
  pnl: number;
  trade_id: string;
  type_of_order: string;
}

export interface SweepSignalLog {
  _id: string;
  deployment_id: string;
  symbol?: string;
  eventType?: string;
  outcome: string;
  level?: number;
  levelType?: string;
  direction?: string;
  sweepExtreme?: number;
  ltp?: number;
  tickCount?: number;
  timestamp?: number;
  created_at?: string;
}

export interface SweepSignalStats {
  total: number;
  confirmed: number;
  confirmationRate: number;
  byOutcome: Array<{ outcome: string; count: number }>;
  byLevelType: Array<{ levelType: string; count: number }>;
}

export interface Deployment {
  _id: string;
  deployment_name: string;
  strategy_id: string;
  account_id: string;
  symbol: string;
  strategy_mode: string;
  current_status: string;
  created_at: string;
}
