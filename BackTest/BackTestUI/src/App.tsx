/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  MOCK_ACCOUNTS, MOCK_STRATEGIES, MOCK_SYMBOLS, MOCK_TRANSACTIONS 
} from './mockData';
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
  // --- Master App States ---
  const [activeScreen, setActiveScreen] = useState<ViewScreen>('dashboard');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  
  const [accounts, setAccounts] = useState<Account[]>(MOCK_ACCOUNTS);
  const [strategies, setStrategies] = useState<Strategy[]>(MOCK_STRATEGIES);
  const [symbols, setSymbols] = useState<SymbolData[]>(MOCK_SYMBOLS);
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [filters, setFilters] = useState<TransactionFilters>(INITIAL_FILTERS);
  
  const [highlightedTxId, setHighlightedTxId] = useState<string | undefined>(undefined);
  const [timezone, setTimezone] = useState<string>('UTC');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // --- Dynamic Simulation Mutators ---
  
  // Appending a new trade & updating related entity balances/stats in real-time!
  const handleAddTransaction = (newTx: Transaction) => {
    // 1. Insert transaction
    setTransactions(prev => [newTx, ...prev]);

    // 2. Adjust corresponding account balance & P&L
    setAccounts(prevAccs => prevAccs.map(acc => {
      if (acc.id === newTx.accountId) {
        const valueDelta = newTx.quantity * newTx.price;
        const feeDelta = newTx.fee;
        const balanceChange = newTx.type === 'BUY' 
          ? -(valueDelta + feeDelta) 
          : (valueDelta - feeDelta);
        
        return {
          ...acc,
          balance: parseFloat((acc.balance + balanceChange).toFixed(2)),
          pnl: parseFloat((acc.pnl + (newTx.type === 'SELL' ? valueDelta : -valueDelta)).toFixed(2))
        };
      }
      return acc;
    }));

    // 3. Increment strategy performance metrics
    setStrategies(prevStrats => prevStrats.map(strat => {
      if (strat.id === newTx.strategyId) {
        const orderValue = newTx.quantity * newTx.price;
        const fakePnlImpact = newTx.type === 'SELL' ? orderValue * 0.05 : -orderValue * 0.02; // simulate yield swing
        const isWin = Math.random() > 0.35; // keep track of randomized win success
        
        return {
          ...strat,
          totalTrades: strat.totalTrades + 1,
          openPositions: newTx.type === 'BUY' ? strat.openPositions + 1 : Math.max(0, strat.openPositions - 1),
          pnl: parseFloat((strat.pnl + fakePnlImpact).toFixed(2)),
          winRate: parseFloat(((strat.winRate * strat.totalTrades + (isWin ? 100 : 0)) / (strat.totalTrades + 1)).toFixed(1))
        };
      }
      return strat;
    }));
  };

  // Toggle API links to simulate disconnect audits
  const handleToggleBrokerStatus = (accountId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id === accountId) {
        return {
          ...acc,
          status: acc.status === 'connected' ? 'disconnected' : 'connected'
        };
      }
      return acc;
    }));
  };

  // Set strategy status
  const handleUpdateStrategyStatus = (stratId: string, status: 'active' | 'paused' | 'stopped') => {
    setStrategies(prev => prev.map(strat => {
      if (strat.id === stratId) {
        return {
          ...strat,
          status
        };
      }
      return strat;
    }));
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
  const handleAddAccount = (newAcc: Account) => {
    setAccounts(prev => [...prev, newAcc]);
  };

  const handleAddStrategy = (newStrat: Strategy) => {
    setStrategies(prev => [...prev, newStrat]);
  };

  const handleAddSymbol = (newSym: SymbolData) => {
    setSymbols(prev => [...prev, newSym]);
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
          <UserProfileView />
        );
      default:
        return <div className="p-8 text-slate-400">View not found.</div>;
    }
  };

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
