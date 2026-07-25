/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useToast } from './components/Toast';
import { Menu } from 'lucide-react';
import { 
  Account, Strategy, SymbolData, Transaction, TransactionFilters, ViewScreen, Broker
} from './types';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import GlobalTransactionsView from './components/GlobalTransactionsView';
import StrategyDetailsView from './components/StrategyDetailsView';
import AccountDetailsView from './components/AccountDetailsView';
import SymbolDetailsView from './components/SymbolDetailsView';
import TransactionDetailModal from './components/TransactionDetailModal';
import AccountsListView from './components/AccountsListView';
import StrategiesListView from './components/StrategiesListView';
import SymbolsListView from './components/SymbolsListView';
import UserProfileView from './components/UserProfileView';
import LoginView from './components/LoginView';
import BrokersListView from './components/BrokersListView';
import StrategyTemplatesView from './components/StrategyTemplatesView';
import DeploymentAnalysisView from './components/DeploymentAnalysisView';
import LiveCandlestickView from './components/LiveCandlestickView';
import { api } from './api';
import { mapAccount, mapSymbol, mapTrade, mapDeployment, mapLedger } from './adapters';
import { applyLiveQuote, tokensMatch, pruneLiveQuotes, LiveQuote } from './utils/instrumentToken';

const INITIAL_FILTERS: TransactionFilters = {
  search: '',
  accounts: [],
  strategies: [],
  symbols: [],
  types: [],
  statuses: [],
  dateRange: 'all',
  customFrom: '',
  customTo: '',
};

export default function App() {
  const { showError, showSuccess } = useToast();

  // --- Auth & Session States ---
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('accessToken'));
  const [currentUser, setCurrentUser] = useState<{ _id: string; username: string; email: string; name: string; is_mfa_enabled: boolean; backup_codes?: string[] } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleProfileUpdate = async () => {
    try {
      const userRes = await api.auth.getMe();
      setCurrentUser(userRes.data);
    } catch (err) {
      console.error('Error refreshing profile:', err);
    }
  };

  // --- Master App States ---
  const [activeScreen, setActiveScreen] = useState<ViewScreen>('dashboard');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyDefinitions, setStrategyDefinitions] = useState<any[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filters, setFilters] = useState<TransactionFilters>(INITIAL_FILTERS);
  
  const [highlightedTxId, setHighlightedTxId] = useState<string | undefined>(undefined);
  const [timezone, setTimezone] = useState<string>('UTC');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // --- Data Loader ---
  const loadData = async () => {
    setIsLoading(true);
    try {
      // Fetch current profile
      const userRes = await api.auth.getMe();
      setCurrentUser(userRes.data);

      // Fetch accounts
      const accountsRes = await api.accounts.list();
      setAccounts(accountsRes.items.map(mapAccount));

      // Fetch watchlisted symbols
      const symbolsRes = await api.symbols.list();
      const mappedSymbols = symbolsRes.items.map(mapSymbol);
      setSymbols(mappedSymbols);
      setLiveQuotes(prev =>
        pruneLiveQuotes(
          prev,
          mappedSymbols.map(s => s.instrumentToken || '').filter(Boolean)
        )
      );

      // Fetch deployments (mapped as strategies in UI)
      const deploymentsRes = await api.deployments.list();
      const mappedStrats = await Promise.all(
        deploymentsRes.items.map(async (dep: any) => {
          try {
            const metrics = await api.deployments.getMetrics(dep._id);
            return mapDeployment(dep, metrics);
          } catch {
            return mapDeployment(dep);
          }
        })
      );
      setStrategies(mappedStrats);

      // Fetch brokers
      const brokersRes = await api.brokers.list();
      setBrokers(brokersRes.items);

      // Fetch strategy definitions
      try {
        const stratsRes = await api.strategies.list();
        setStrategyDefinitions(stratsRes.items);
      } catch (err) {
        console.error('Error loading strategy definitions:', err);
      }

      // Fetch ledger (mapped as transactions in UI)
      const ledgerRes = await api.ledger.list();
      setTransactions(ledgerRes.items.map(mapLedger));
    } catch (err) {
      console.error('Error loading API data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  // --- Periodic Token Refresh ---
  useEffect(() => {
    if (!isAuthenticated) return;

    // Refresh token periodically (every 10 minutes, since access token expires in 15 minutes)
    const refreshInterval = setInterval(async () => {
      try {
        console.log('[Auth] Periodically refreshing access token...');
        await api.auth.refreshToken();
        console.log('[Auth] Access token refreshed successfully.');
      } catch (err: any) {
        console.error('[Auth] Failed to refresh token periodically:', err);
        // Only treat as session expired if it is explicitly an authentication error (like 401/403/400 or missing refresh token)
        if (err?.isAuthError) {
          setIsAuthenticated(false);
          setCurrentUser(null);
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.dispatchEvent(new Event('auth-unauthorized'));
        }
      }
    }, 10 * 60 * 1000); // 10 minutes in milliseconds

    // Also run an initial check/refresh when the app loads to make sure we have a fresh token
    const initialRefresh = async () => {
      try {
        await api.auth.ensureValidToken();
      } catch (err) {
        console.error('[Auth] Failed initial token refresh check:', err);
      }
    };
    initialRefresh();

    return () => clearInterval(refreshInterval);
  }, [isAuthenticated]);

  // --- Live WebSocket Pricing Stream ---
  useEffect(() => {
    if (!isAuthenticated) return;

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;

    console.log('[Live Feed] Initiating WebSocket connection flow...');
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isDisposed = false;

    const connect = async () => {
      if (isDisposed) return;
      
      let token = '';
      try {
        // Ensure we have a valid token (refreshes if close to expiry or expired)
        const freshToken = await api.auth.ensureValidToken();
        token = freshToken || '';
      } catch (err) {
        console.error('[Live Feed] Token refresh failed for WebSocket:', err);
      }
      
      if (isDisposed) return;
      const wsUrl = `${wsProto}//${wsHost}/backtestapp/ws?token=${encodeURIComponent(token)}`;

      console.log('[Live Feed] Connecting to WebSocket...');
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Live Feed] Connected to BackTest live WebSocket');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.event === 'broker_updated') {
            console.log('[Live Feed] Broker updated event received:', msg);
            window.dispatchEvent(new CustomEvent('broker-updated', { detail: msg }));
            loadData();
          } else if (msg && msg.instrument_token && msg.last_price !== undefined) {
            const patch: LiveQuote = { lastPrice: msg.last_price };
            if (typeof msg.change_pct === 'number' && !Number.isNaN(msg.change_pct)) {
              patch.change24h = msg.change_pct;
            }
            if (typeof msg.volume === 'number' && !Number.isNaN(msg.volume)) {
              patch.volume24h = msg.volume;
            }
            setLiveQuotes(prev => applyLiveQuote(prev, msg.instrument_token, patch));
            setSymbols(prevSymbols =>
              prevSymbols.map(sym =>
                tokensMatch(sym.instrumentToken || '', msg.instrument_token)
                  ? {
                      ...sym,
                      lastPrice: msg.last_price,
                      ...(patch.change24h !== undefined ? { change24h: patch.change24h } : {}),
                      ...(patch.volume24h !== undefined ? { volume24h: patch.volume24h } : {}),
                    }
                  : sym
              )
            );
          }
        } catch (err) {
          console.error('[Live Feed] Error parsing live WS message:', err);
        }
      };

      ws.onclose = () => {
        if (isDisposed) return;
        console.log('[Live Feed] BackTest live WebSocket disconnected. Reconnecting in 3s...');
        reconnectTimeout = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.error('[Live Feed] BackTest live WebSocket error:', err);
      };
    };

    connect();

    return () => {
      isDisposed = true;
      clearTimeout(reconnectTimeout);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [isAuthenticated]);

  // Auth logout / unauthorized event handler
  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      setCurrentUser(null);
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLogout = async () => {
    await api.auth.logout();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setActiveScreen('dashboard');
  };

  // --- Dynamic Simulation & Mutation Handlers ---
  
  const handleAddTransaction = async (newTx: Transaction) => {
    try {
      await api.trades.create({
        account_id: newTx.accountId,
        symbol: newTx.symbol,
        price: newTx.price,
        quantity: newTx.quantity,
        type_of_order: newTx.type,
        deployment_id: newTx.strategyId,
      });
      await loadData();
    } catch (err: any) {
      showError(`Failed to execute trade: ${err.message}`);
      throw err;
    }
  };

  // Toggle API links to simulate disconnect audits
  const handleToggleBrokerStatus = async (accountId: string) => {
    const target = accounts.find(a => a.id === accountId);
    if (!target) return;
    const nextActive = target.status !== 'connected';
    try {
      await api.accounts.update(accountId, { is_active: nextActive });
      setAccounts(prev => prev.map(acc => {
        if (acc.id === accountId) {
          return {
            ...acc,
            status: nextActive ? 'connected' : 'disconnected'
          };
        }
        return acc;
      }));
    } catch (err: any) {
      showError(`Failed to update account state: ${err.message}`);
    }
  };

  // Set strategy status
  const handleUpdateStrategyStatus = async (stratId: string, status: 'active' | 'paused' | 'stopped') => {
    const target = strategies.find(s => s.id === stratId);
    if (!target) return;
    try {
      if (status === 'active') {
        if (target.status === 'paused') {
          await api.deployments.resume(stratId);
        } else {
          await api.deployments.start(stratId);
        }
      } else if (status === 'paused') {
        await api.deployments.pause(stratId);
      } else if (status === 'stopped') {
        await api.deployments.stop(stratId);
      }
      
      setStrategies(prev => prev.map(strat => {
        if (strat.id === stratId) {
          return { ...strat, status };
        }
        return strat;
      }));
      await loadData();
    } catch (err: any) {
      showError(`Failed to update strategy execution status: ${err.message}`);
    }
  };

  // Override audit remarks/notes
  const handleUpdateNotes = (txId: string, notes: string) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.id === txId) {
        return { ...tx, notes };
      }
      return tx;
    }));
    // Keep inspecting modal in sync
    setSelectedTransaction(prev => {
      if (prev && prev.id === txId) {
        return { ...prev, notes };
      }
      return prev;
    });
  };

  // Toggle flags in single transaction audit
  const handleToggleFlag = (txId: string) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.id === txId) {
        return { ...tx, flagged: !tx.flagged };
      }
      return tx;
    }));
    // Keep inspecting modal in sync
    setSelectedTransaction(prev => {
      if (prev && prev.id === txId) {
        return { ...prev, flagged: !prev.flagged };
      }
      return prev;
    });
  };

  // --- Dynamic Entity Creators ---
  const handleAddAccount = async (newAcc: Account) => {
    try {
      const res = await api.accounts.create({
        account_name: newAcc.name,
        account_type: newAcc.accountType || 'SIMULATION',
        initial_balance: newAcc.initialBalance,
        description: `broker:${newAcc.broker}`,
        commission_type: newAcc.commissionType,
        commission_rate: newAcc.commissionRate,
        broker_id: newAcc.brokerId,
      });
      const mapped = mapAccount(res.data);
      setAccounts(prev => [...prev, mapped]);
      loadData();
    } catch (err: any) {
      showError(`Failed to register account: ${err.message}`);
    }
  };

  const handleAddStrategy = async (
    newStrat: Strategy,
    accountId: string,
    symbol: string,
    existingStrategyId: string,
    symbolControl?: {
      enabled: boolean;
      underlyingUserSymbolId: string;
      moneyness: 'ITM' | 'ATM' | 'OTM';
      offset: number;
      optionType: 'CE' | 'PE';
      expiry: string;
    },
    sizing?: {
      lotSize?: number | null;
      noOfLots?: number;
    }
  ) => {
    try {
      // 1. Resolve strategy definition
      const strategyId = existingStrategyId;
      if (!strategyId) {
        throw new Error("Strategy template is required for deployment");
      }

      const payload: Parameters<typeof api.deployments.create>[0] = {
        strategy_id: strategyId,
        account_id: accountId,
        start_time: new Date().toISOString(),
        current_status: newStrat.status === 'active' ? 'RUNNING' : newStrat.status === 'paused' ? 'PAUSED' : 'SCHEDULED',
        strategy_mode: newStrat.mode === 'live' ? 'LIVE' : newStrat.mode === 'paper' ? 'PAPER' : 'BACKTEST',
        deployment_name: newStrat.name,
        notes: newStrat.description,
        backtest_date: newStrat.backtestDate,
        backtest_speed: newStrat.backtestSpeed,
        use_full_amount: newStrat.useFullAmount,
        no_of_lots: sizing?.noOfLots ?? newStrat.noOfLots ?? 1,
        timeframe: newStrat.timeframe || '1m',
      };

      if (sizing?.lotSize != null && Number(sizing.lotSize) > 0) {
        payload.lot_size = Number(sizing.lotSize);
      }

      if (symbolControl?.enabled) {
        payload.symbol_control = {
          enabled: true,
          underlying_user_symbol_id: symbolControl.underlyingUserSymbolId,
          moneyness: symbolControl.moneyness,
          offset: symbolControl.offset,
          option_type: symbolControl.optionType,
          expiry: symbolControl.expiry || 'current_week',
        };
      } else {
        // 2. Resolve UserSymbol for static target symbol
        let userSymbolId = '';
        let instrumentToken = '';
        const byTicker = symbols.find(s => s.ticker === symbol);
        if (byTicker?.id) {
          userSymbolId = byTicker.id;
          instrumentToken = byTicker.instrumentToken || '';
          if (byTicker.lotSize != null && !(Number(payload.lot_size) > 0)) {
            payload.lot_size = Number(byTicker.lotSize);
          }
        }

        if (!userSymbolId) {
          const rawSymbols = await api.symbols.list();
          const found = rawSymbols.items.find(s => s.symbol === symbol);
          if (found) {
            userSymbolId = found._id;
            instrumentToken = found.instrument_token;
            if (found.lot_size != null && !(Number(payload.lot_size) > 0)) {
              payload.lot_size = Number(found.lot_size);
            }
          }
        }

        if (!userSymbolId) {
          const symRes = await api.symbols.create({
            symbol,
            exchange: 'NSE',
            instrument_token: symbol,
            symbol_name: symbol,
            description: `Auto-generated symbol for strategy deployment`,
            instrument_class: 'EQUITY',
          });
          userSymbolId = symRes.data._id;
          instrumentToken = symRes.data.instrument_token;
        }

        payload.user_symbol_id = userSymbolId;
        payload.instrument_token = instrumentToken;
        payload.symbol = symbol;
      }

      // 3. Deploy
      const depRes = await api.deployments.create(payload);

      const mappedStrat = mapDeployment(depRes.data);
      setStrategies(prev => [...prev, mappedStrat]);
      loadData(); // Reload stats and items to keep fully synchronized
    } catch (err: any) {
      showError(`Failed to deploy strategy: ${err.message}`);
    }
  };

  const handleCreateStrategyDefinition = async (
    name: string,
    description: string,
    advanceTradeDecision?: boolean,
    targetPts?: number,
    slPts?: number,
    targetType?: string,
    targetPct?: number,
    slPct?: number
  ) => {
    try {
      await api.strategies.create({
        strategy_name: name,
        strategy_description: description,
        advance_trade_decision: advanceTradeDecision,
        target_pts: targetPts,
        sl_pts: slPts,
        target_type: targetType,
        target_pct: targetPct,
        sl_pct: slPct,
      });
      await loadData();
    } catch (err: any) {
      showError(`Failed to create strategy template: ${err.message}`);
      throw err;
    }
  };

  const handleAddSymbol = async (newSym: SymbolData) => {
    try {
      const res = await api.symbols.create({
        symbol: newSym.ticker,
        exchange: newSym.exchange || 'NSE',
        instrument_token: newSym.instrumentToken || `TOKEN_${newSym.ticker}`,
        symbol_name: newSym.name,
        description: newSym.description || '',
        instrument_class: newSym.instrumentClass || 'EQUITY',
        ...((newSym.instrumentClass === 'INDEX' || newSym.instrumentClass === 'EQUITY') &&
        newSym.strikePriceDiff
          ? { strike_price_diff: newSym.strikePriceDiff }
          : {}),
        ...(newSym.instrumentClass === 'OPTION' && newSym.lotSize
          ? { lot_size: newSym.lotSize }
          : {}),
      });
      const mapped = mapSymbol(res.data);
      setSymbols(prev => [...prev, mapped]);
    } catch (err: any) {
      showError(`Failed to add symbol to watchlist: ${err.message}`);
    }
  };

  const handleToggleSymbolActive = async (id: string, isActive: boolean) => {
    try {
      await api.symbols.update(id, { is_active: isActive });
      setSymbols(prev => prev.map(s => {
        if (s.id === id) {
          return { ...s, isActive };
        }
        return s;
      }));
      const sym = symbols.find(s => s.id === id);
      showSuccess(`${sym?.ticker || 'Symbol'} ${isActive ? 'activated' : 'deactivated'} successfully`);
      await loadData();
    } catch (err: any) {
      showError(`Failed to update symbol activation state: ${err.message}`);
    }
  };

  const handleEditAccount = async (id: string, updateData: any) => {
    try {
      await api.accounts.update(id, updateData);
      showSuccess("Account updated successfully");
      await loadData();
    } catch (err: any) {
      showError(`Failed to update account: ${err.message}`);
      throw err;
    }
  };

  const handleDeleteAccount = async (id: string) => {
    try {
      await api.accounts.delete(id);
      showSuccess("Account and all associated deployments, trades, positions, and ledgers deleted successfully");
      if (selectedEntityId === id) {
        setSelectedEntityId(null);
        setActiveScreen('accounts-list');
      }
      await loadData();
    } catch (err: any) {
      showError(`Failed to delete account: ${err.message}`);
      throw err;
    }
  };

  const handleEditStrategy = async (id: string, updateData: any) => {
    try {
      await api.deployments.update(id, updateData);
      showSuccess("Deployment updated successfully");
      await loadData();
    } catch (err: any) {
      showError(`Failed to update deployment: ${err.message}`);
      throw err;
    }
  };

  const handleDeleteStrategy = async (id: string) => {
    try {
      await api.deployments.delete(id);
      showSuccess("Deployment and all associated trades, positions, and ledgers deleted successfully");
      if (selectedEntityId === id) {
        setSelectedEntityId(null);
        setActiveScreen('strategies-list');
      }
      await loadData();
    } catch (err: any) {
      showError(`Failed to delete deployment: ${err.message}`);
      throw err;
    }
  };

  const handleEditStrategyTemplate = async (id: string, updateData: any) => {
    try {
      await api.strategies.update(id, updateData);
      showSuccess("Strategy template updated successfully");
      await loadData();
    } catch (err: any) {
      showError(`Failed to update strategy template: ${err.message}`);
      throw err;
    }
  };

  const handleDeleteStrategyTemplate = async (id: string) => {
    try {
      await api.strategies.delete(id);
      showSuccess("Strategy template and all its associated deployments, trades, positions, and ledgers deleted successfully");
      await loadData();
    } catch (err: any) {
      showError(`Failed to delete strategy template: ${err.message}`);
      throw err;
    }
  };

  const handleEditSymbol = async (id: string, updateData: any) => {
    try {
      await api.symbols.update(id, updateData);
      showSuccess("Tracked symbol updated successfully");
      await loadData();
    } catch (err: any) {
      showError(`Failed to update tracked symbol: ${err.message}`);
      throw err;
    }
  };

  const handleDeleteSymbol = async (id: string, ticker: string) => {
    try {
      await api.symbols.delete(id);
      showSuccess("Tracked symbol and all associated deployments, trades, positions, and ledgers deleted successfully");
      if (selectedEntityId === ticker) {
        setSelectedEntityId(null);
        setActiveScreen('symbols-list');
      }
      await loadData();
    } catch (err: any) {
      showError(`Failed to delete tracked symbol: ${err.message}`);
      throw err;
    }
  };

  // --- Router & Entity Drilldown Navigation ---
  
  const handleNavigate = (screen: ViewScreen) => {
    setActiveScreen(screen);
    setHighlightedTxId(undefined); // Reset highlights on page change
  };

  const handleSelectEntity = (type: 'account' | 'strategy' | 'symbol', id: string) => {
    setSelectedEntityId(id);
    setActiveScreen(`${type}-detail` as any);
    setHighlightedTxId(undefined);
  };

  // View all drilldown to Transactions screen with active filter pre-filled
  const handleDrilldownToTransactions = (filterKey: 'accountId' | 'strategyId' | 'symbol', filterValue: string, specificTxId?: string) => {
    setFilters(prev => {
      const freshFilters = { ...INITIAL_FILTERS };
      if (filterKey === 'accountId') {
        freshFilters.accounts = [filterValue];
      } else if (filterKey === 'strategyId') {
        freshFilters.strategies = [filterValue];
      } else if (filterKey === 'symbol') {
        freshFilters.symbols = [filterValue];
      }
      return freshFilters;
    });

    if (specificTxId) {
      setHighlightedTxId(specificTxId);
    }

    setActiveScreen('transactions');
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  // --- Active Sub-View Render Projection ---
  const renderActiveScreen = () => {
    switch (activeScreen) {
      case 'dashboard':
        return (
          <DashboardView
            accounts={accounts}
            strategies={strategies}
            symbols={symbols}
            transactions={transactions}
            onAddTransaction={handleAddTransaction}
            onToggleBrokerStatus={handleToggleBrokerStatus}
            onNavigateToEntity={handleSelectEntity}
            onSelectTransaction={setSelectedTransaction}
          />
        );
      case 'transactions':
        return (
          <GlobalTransactionsView
            accounts={accounts}
            strategies={strategies}
            symbols={symbols}
            filters={filters}
            onUpdateFilters={setFilters}
            onResetFilters={handleResetFilters}
            onSelectTransaction={setSelectedTransaction}
            highlightedTxId={highlightedTxId}
            timezone={timezone}
            onRefreshData={loadData}
          />
        );
      case 'accounts-list':
        return (
          <AccountsListView
            accounts={accounts}
            brokers={brokers}
            onAddAccount={handleAddAccount}
            onToggleBrokerStatus={handleToggleBrokerStatus}
            onNavigateToEntity={handleSelectEntity}
            onRefreshData={loadData}
            onEditAccount={handleEditAccount}
            onDeleteAccount={handleDeleteAccount}
          />
        );
      case 'strategies-list':
        return (
          <StrategiesListView
            strategies={strategies}
            symbols={symbols}
            accounts={accounts}
            strategyDefinitions={strategyDefinitions}
            onAddStrategy={handleAddStrategy}
            onUpdateStrategyStatus={handleUpdateStrategyStatus}
            onNavigateToEntity={handleSelectEntity}
            onRefreshData={loadData}
            onEditStrategy={handleEditStrategy}
            onDeleteStrategy={handleDeleteStrategy}
          />
        );
      case 'strategy-templates':
        return (
          <StrategyTemplatesView
            strategyDefinitions={strategyDefinitions}
            onCreateStrategy={handleCreateStrategyDefinition}
            onEditStrategyTemplate={handleEditStrategyTemplate}
            onDeleteStrategyTemplate={handleDeleteStrategyTemplate}
          />
        );
      case 'symbols-list':
        return (
          <SymbolsListView
            symbols={symbols}
            liveQuotes={liveQuotes}
            onAddSymbol={handleAddSymbol}
            onNavigateToEntity={handleSelectEntity}
            onRefreshData={loadData}
            onToggleSymbolActive={handleToggleSymbolActive}
            onEditSymbol={handleEditSymbol}
            onDeleteSymbol={handleDeleteSymbol}
          />
        );
      case 'strategy-detail':
        const matchedStrat = strategies.find(s => s.id === selectedEntityId) || strategies[0];
        return (
          <StrategyDetailsView
            strategy={matchedStrat}
            symbols={symbols}
            onBackToDashboard={() => setActiveScreen('dashboard')}
            onUpdateStrategyStatus={handleUpdateStrategyStatus}
            onNavigateToEntity={handleSelectEntity}
            onSelectTransaction={setSelectedTransaction}
            onDrilldownToTransactions={(key, val) => handleDrilldownToTransactions(key, val)}
            timezone={timezone}
            onNavigateToScreen={setActiveScreen}
            onRefreshData={loadData}
            onEditStrategy={handleEditStrategy}
            onDeleteStrategy={handleDeleteStrategy}
          />
        );
      case 'account-detail':
        const matchedAcc = accounts.find(a => a.id === selectedEntityId) || accounts[0];
        return (
          <AccountDetailsView
            account={matchedAcc}
            accounts={accounts}
            strategies={strategies}
            onBackToDashboard={() => setActiveScreen('dashboard')}
            onToggleBrokerStatus={handleToggleBrokerStatus}
            onSelectTransaction={setSelectedTransaction}
            onDrilldownToTransactions={(key, val) => handleDrilldownToTransactions(key, val)}
            timezone={timezone}
            onRefreshData={loadData}
            onNavigateToScreen={setActiveScreen}
            onEditAccount={handleEditAccount}
            onDeleteAccount={handleDeleteAccount}
          />
        );
      case 'symbol-detail':
        const matchedSym = symbols.find(s => s.ticker === selectedEntityId) || symbols[0];
        return (
          <SymbolDetailsView
            symbol={matchedSym}
            strategies={strategies}
            onBackToDashboard={() => setActiveScreen('dashboard')}
            onNavigateToEntity={handleSelectEntity}
            onSelectTransaction={setSelectedTransaction}
            onDrilldownToTransactions={(key, val) => handleDrilldownToTransactions(key, val)}
            timezone={timezone}
            onNavigateToScreen={setActiveScreen}
            onRefreshData={loadData}
            onToggleSymbolActive={handleToggleSymbolActive}
            onEditSymbol={handleEditSymbol}
            onDeleteSymbol={handleDeleteSymbol}
          />
        );
      case 'profile':
        return (
          <UserProfileView currentUser={currentUser} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} />
        );
      case 'brokers-list':
        return (
          <BrokersListView />
        );
      case 'deployment-analysis':
        return (
          <DeploymentAnalysisView selectedDeploymentId={selectedEntityId} timezone={timezone} onSelectTransaction={setSelectedTransaction} />
        );
      case 'live-candlestick':
        return (
          <LiveCandlestickView symbols={symbols} timezone={timezone} />
        );
      default:
        return <div className="p-8 text-slate-400">View not found.</div>;
    }
  };

  if (!isAuthenticated) {
    return <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  if (isLoading && accounts.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-sans">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-mono tracking-wider">Loading Platform Audits...</p>
        </div>
      </div>
    );
  }

  return (
    <div id="cobratrades-app-container" className="flex bg-slate-900 text-slate-100 min-h-screen">
      
      {/* Sidebar Navigation */}
      <Sidebar
        activeScreen={activeScreen}
        onNavigate={handleNavigate}
        accounts={accounts}
        strategies={strategies}
        symbols={symbols}
        strategyDefinitions={strategyDefinitions}
        selectedEntityId={selectedEntityId}
        onSelectEntity={handleSelectEntity}
        timezone={timezone}
        onTimezoneChange={(tz) => setTimezone(tz)}
        currentUser={currentUser}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Panel Frame */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Top Bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 shrink-0">
          <button
            id="hamburger-menu-btn"
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-500 rounded flex items-center justify-center font-bold text-white text-xs">C</div>
            <span className="text-sm font-bold text-white uppercase tracking-tight">CobraTrades</span>
          </div>
          {/* Mobile User Profile Button */}
          <button
            id="mobile-header-profile-btn"
            onClick={() => {
              setActiveScreen('profile');
              setSelectedEntityId(null);
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
              activeScreen === 'profile'
                ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-md'
                : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
            aria-label="User Profile"
            title="View User Profile"
          >
            {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('') : 'PS'}
          </button>
        </header>

        <main id="main-content-scroll" className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          {renderActiveScreen()}
        </main>
      </div>

      {/* Inspect Detail Drawer Modal */}
      {selectedTransaction && (
        <TransactionDetailModal
          transaction={selectedTransaction}
          accounts={accounts}
          strategies={strategies}
          symbols={symbols}
          onClose={() => setSelectedTransaction(null)}
          onToggleFlag={handleToggleFlag}
          onUpdateNotes={handleUpdateNotes}
          onNavigateToEntity={(type, id) => {
            setSelectedTransaction(null); // Close modal before drilling down
            handleSelectEntity(type, id);
          }}
          timezone={timezone}
        />
      )}
    </div>
  );
}
