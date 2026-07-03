/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Account, Strategy, SymbolData, Transaction, TransactionFilters, ViewScreen 
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
import { api } from './api';
import { mapAccount, mapSymbol, mapTrade, mapDeployment } from './adapters';

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
  // --- Auth & Session States ---
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('accessToken'));
  const [currentUser, setCurrentUser] = useState<{ _id: string; username: string; email: string; name: string; is_mfa_enabled: boolean; backup_codes?: string[] } | null>(null);
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
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
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
      setSymbols(symbolsRes.items.map(mapSymbol));

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

      // Fetch trades (mapped as transactions in UI)
      const tradesRes = await api.trades.list();
      setTransactions(tradesRes.items.map(mapTrade));
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
  
  const handleAddTransaction = (newTx: Transaction) => {
    // Read-only / system-generated locally, but keep simulation sync if needed
    setTransactions(prev => [newTx, ...prev]);
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
      alert(`Failed to update account state: ${err.message}`);
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
    } catch (err: any) {
      alert(`Failed to update strategy execution status: ${err.message}`);
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
        account_type: 'SIMULATION',
        initial_balance: newAcc.initialBalance,
        description: `broker:${newAcc.broker}`,
      });
      const mapped = mapAccount(res.data);
      setAccounts(prev => [...prev, mapped]);
    } catch (err: any) {
      alert(`Failed to register account: ${err.message}`);
    }
  };

  const handleAddStrategy = async (newStrat: Strategy, accountId: string, symbol: string) => {
    try {
      // 1. Create strategy definition
      const stratRes = await api.strategies.create({
        strategy_name: newStrat.name,
        strategy_description: newStrat.description,
      });
      const strategyId = stratRes.data._id;

      // 2. Resolve UserSymbol for target symbol
      let userSymbolId = '';
      let instrumentToken = '';
      const existingSymbol = symbols.find(s => s.ticker === symbol);
      if (existingSymbol) {
        const rawSymbols = await api.symbols.list();
        const found = rawSymbols.items.find(s => s.symbol === symbol);
        if (found) {
          userSymbolId = found._id;
          instrumentToken = found.instrument_token;
        }
      }

      if (!userSymbolId) {
        const symRes = await api.symbols.create({
          symbol,
          exchange: 'NSE',
          instrument_token: `TOKEN_${symbol}`,
        });
        userSymbolId = symRes.data._id;
        instrumentToken = symRes.data.instrument_token;
      }

      // 3. Deploy
      const depRes = await api.deployments.create({
        strategy_id: strategyId,
        account_id: accountId,
        user_symbol_id: userSymbolId,
        instrument_token: instrumentToken,
        symbol: symbol,
        start_time: new Date().toISOString(),
        current_status: newStrat.status === 'active' ? 'RUNNING' : newStrat.status === 'paused' ? 'PAUSED' : 'SCHEDULED',
        strategy_mode: newStrat.mode === 'live' ? 'LIVE' : 'BACKTEST',
        deployment_name: newStrat.name,
        notes: newStrat.description,
      });

      const mappedStrat = mapDeployment(depRes.data);
      setStrategies(prev => [...prev, mappedStrat]);
      loadData(); // Reload stats and items to keep fully synchronized
    } catch (err: any) {
      alert(`Failed to deploy strategy: ${err.message}`);
    }
  };

  const handleAddSymbol = async (newSym: SymbolData) => {
    try {
      const res = await api.symbols.create({
        symbol: newSym.ticker,
        exchange: newSym.exchange || 'NSE',
        instrument_token: `TOKEN_${newSym.ticker}`,
      });
      const mapped = mapSymbol(res.data);
      setSymbols(prev => [...prev, mapped]);
    } catch (err: any) {
      alert(`Failed to add symbol to watchlist: ${err.message}`);
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
            transactions={transactions}
            accounts={accounts}
            strategies={strategies}
            symbols={symbols}
            filters={filters}
            onUpdateFilters={setFilters}
            onResetFilters={handleResetFilters}
            onSelectTransaction={setSelectedTransaction}
            highlightedTxId={highlightedTxId}
            timezone={timezone}
          />
        );
      case 'accounts-list':
        return (
          <AccountsListView
            accounts={accounts}
            onAddAccount={handleAddAccount}
            onToggleBrokerStatus={handleToggleBrokerStatus}
            onNavigateToEntity={handleSelectEntity}
          />
        );
      case 'strategies-list':
        return (
          <StrategiesListView
            strategies={strategies}
            symbols={symbols}
            accounts={accounts}
            onAddStrategy={handleAddStrategy}
            onUpdateStrategyStatus={handleUpdateStrategyStatus}
            onNavigateToEntity={handleSelectEntity}
          />
        );
      case 'symbols-list':
        return (
          <SymbolsListView
            symbols={symbols}
            onAddSymbol={handleAddSymbol}
            onNavigateToEntity={handleSelectEntity}
          />
        );
      case 'strategy-detail':
        const matchedStrat = strategies.find(s => s.id === selectedEntityId) || strategies[0];
        return (
          <StrategyDetailsView
            strategy={matchedStrat}
            symbols={symbols}
            transactions={transactions}
            onBackToDashboard={() => setActiveScreen('dashboard')}
            onUpdateStrategyStatus={handleUpdateStrategyStatus}
            onNavigateToEntity={handleSelectEntity}
            onSelectTransaction={setSelectedTransaction}
            onDrilldownToTransactions={(key, val) => handleDrilldownToTransactions(key, val)}
            timezone={timezone}
          />
        );
      case 'account-detail':
        const matchedAcc = accounts.find(a => a.id === selectedEntityId) || accounts[0];
        return (
          <AccountDetailsView
            account={matchedAcc}
            transactions={transactions}
            strategies={strategies}
            onBackToDashboard={() => setActiveScreen('dashboard')}
            onToggleBrokerStatus={handleToggleBrokerStatus}
            onSelectTransaction={setSelectedTransaction}
            onDrilldownToTransactions={(key, val) => handleDrilldownToTransactions(key, val)}
            timezone={timezone}
          />
        );
      case 'symbol-detail':
        const matchedSym = symbols.find(s => s.ticker === selectedEntityId) || symbols[0];
        return (
          <SymbolDetailsView
            symbol={matchedSym}
            transactions={transactions}
            strategies={strategies}
            onBackToDashboard={() => setActiveScreen('dashboard')}
            onNavigateToEntity={handleSelectEntity}
            onSelectTransaction={setSelectedTransaction}
            onDrilldownToTransactions={(key, val) => handleDrilldownToTransactions(key, val)}
            timezone={timezone}
          />
        );
      case 'profile':
        return (
          <UserProfileView currentUser={currentUser} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} />
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
        selectedEntityId={selectedEntityId}
        onSelectEntity={handleSelectEntity}
        timezone={timezone}
        onTimezoneChange={(tz) => setTimezone(tz)}
        currentUser={currentUser}
      />

      {/* Main Panel Frame */}
      <main id="main-content-scroll" className="flex-1 overflow-y-auto h-screen p-6 md:p-8 space-y-6">
        {renderActiveScreen()}
      </main>

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
