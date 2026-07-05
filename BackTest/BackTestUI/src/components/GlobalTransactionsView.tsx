/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, SlidersHorizontal, X, Bookmark, Calendar, Filter, 
  Check, ChevronDown, RefreshCw, Sparkles, HelpCircle 
} from 'lucide-react';
import { Transaction, Account, Strategy, SymbolData, TransactionFilters } from '../types';
import TransactionList from './TransactionList';
import { api } from '../api';
import { mapTrade, mapLedger } from '../adapters';

interface GlobalTransactionsViewProps {
  accounts: Account[];
  strategies: Strategy[];
  symbols: SymbolData[];
  filters: TransactionFilters;
  onUpdateFilters: (updater: (prev: TransactionFilters) => TransactionFilters) => void;
  onResetFilters: () => void;
  onSelectTransaction: (tx: Transaction) => void;
  highlightedTxId?: string;
  timezone: string;
}

export default function GlobalTransactionsView({
  accounts,
  strategies,
  symbols,
  filters,
  onUpdateFilters,
  onResetFilters,
  onSelectTransaction,
  highlightedTxId,
  timezone,
}: GlobalTransactionsViewProps) {
  
  const [showAdvanceFilters, setShowAdvanceFilters] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // --- Smart data fetching with race condition protection ---
  //
  // Key design decisions:
  //  1. fetchId ref: Discards stale responses if a newer fetch has started.
  //  2. Filters passed as parameter: Avoids closure staleness (captures snapshot at call time).
  //  3. Cross-entity fetch strategy:
  //     - Single entity type selected → server-side scoped fetch for each entity in that type (OR within same type)
  //     - Multiple entity TYPES selected (e.g. Account + Strategy) → fetch scoped by the
  //       most-restrictive filter first (accounts > strategies > symbols), then let client-side
  //       AND logic eliminate non-matches. This avoids the union-then-AND problem where
  //       fetching both Account A and Strategy B produces a union that, after client AND,
  //       returns zero results even when both have trades (just not overlapping ones).
  //  4. No entity filters → fetch full ledger.
  //  5. Search / date / type / status remain client-side (applied on the fetched pool).

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const fetchIdRef = React.useRef(0);

  // Multi-level sort configuration state
  const [sortConfigs, setSortConfigs] = useState<Array<{ field: string; direction: 'asc' | 'desc' }>>([
    { field: 'timestamp', direction: 'desc' }
  ]);

  const fetchTransactions = async (currentFilters: typeof filters) => {
    // Bump fetch ID — any in-flight fetch with an older ID will discard its result
    const fetchId = ++fetchIdRef.current;
    setTxLoading(true);
    setTxError(null);
    try {
      const hasAccountFilter  = currentFilters.accounts.length > 0;
      const hasStrategyFilter = currentFilters.strategies.length > 0;
      const hasSymbolFilter   = currentFilters.symbols.length > 0;
      const hasTypeFilter     = currentFilters.types.length > 0;
      const hasStatusFilter   = currentFilters.statuses.length > 0;
      const hasDateFilter     = currentFilters.dateRange !== 'all';
      const hasEntityFilter   = hasAccountFilter || hasStrategyFilter || hasSymbolFilter || hasTypeFilter || hasStatusFilter || hasDateFilter;

      let items: Transaction[] = [];
      const sortParam = sortConfigs.map(c => `${c.field}:${c.direction}`).join(',');

      if (!hasEntityFilter) {
        // No filters: fetch full ledger snapshot with sorting
        const res = await api.ledger.list(sortParam);
        items = res.items.map(mapLedger);
      } else {
        // Calculate date range bounds
        let fromDateStr: string | undefined = undefined;
        let toDateStr: string | undefined = undefined;

        if (currentFilters.dateRange !== 'all') {
          const now = new Date();
          if (currentFilters.dateRange === 'today') {
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            fromDateStr = startOfToday.toISOString();
          } else if (currentFilters.dateRange === '7d') {
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            fromDateStr = sevenDaysAgo.toISOString();
          } else if (currentFilters.dateRange === '30d') {
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            fromDateStr = thirtyDaysAgo.toISOString();
          } else if (currentFilters.dateRange === 'custom') {
            if (currentFilters.customFrom) {
              fromDateStr = new Date(currentFilters.customFrom).toISOString();
            }
            if (currentFilters.customTo) {
              toDateStr = new Date(currentFilters.customTo).toISOString();
            }
          }
        }

        // Fetch from server in a single request with all combined filters and multi-level sorting!
        const res = await api.trades.listWithFilters({
          account_id: hasAccountFilter ? currentFilters.accounts : undefined,
          deployment_id: hasStrategyFilter ? currentFilters.strategies : undefined,
          symbol: hasSymbolFilter ? currentFilters.symbols : undefined,
          type_of_order: hasTypeFilter ? currentFilters.types : undefined,
          status: hasStatusFilter ? currentFilters.statuses : undefined,
          from: fromDateStr,
          to: toDateStr,
          sort: sortParam,
        });

        items = res.items.map(mapTrade);
      }

      // Discard if a newer fetch has started
      if (fetchId !== fetchIdRef.current) return;

      setTransactions(items);
    } catch (err: any) {
      if (fetchId !== fetchIdRef.current) return;
      setTxError(err.message || 'Failed to load ledger');
    } finally {
      if (fetchId !== fetchIdRef.current) return;
      setTxLoading(false);
    }
  };

  // Re-fetch whenever filters or sort config changes (server-side scoped fetch).
  useEffect(() => {
    fetchTransactions(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.accounts.join(','),
    filters.strategies.join(','),
    filters.symbols.join(','),
    filters.types.join(','),
    filters.statuses.join(','),
    filters.dateRange,
    filters.customFrom,
    filters.customTo,
    sortConfigs.map(c => `${c.field}:${c.direction}`).join(','),
  ]);

  // Quick range helper
  const handleDateShortcut = (range: TransactionFilters['dateRange']) => {
    onUpdateFilters(prev => ({ ...prev, dateRange: range }));
    setActivePreset(null);
  };

  // Check if any filters are actively modified (excluding defaults)
  const isFiltered = useMemo(() => {
    return (
      filters.search !== '' ||
      filters.accounts.length > 0 ||
      filters.strategies.length > 0 ||
      filters.symbols.length > 0 ||
      filters.types.length > 0 ||
      filters.statuses.length > 0 ||
      filters.dateRange !== 'all'
    );
  }, [filters]);

  // Handle individual filter chip removal
  const handleRemoveChip = (key: keyof TransactionFilters, val?: any) => {
    onUpdateFilters(prev => {
      const updated = { ...prev };
      if (key === 'search') {
        updated.search = '';
      } else if (key === 'dateRange') {
        updated.dateRange = 'all';
      } else if (Array.isArray(updated[key])) {
        updated[key] = (updated[key] as any).filter((v: any) => v !== val);
      }
      return updated;
    });
  };

  // --- Filtering Execution Logic ---
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // 1. Search Query Matcher (Matches Symbol, Strategy ID, Account ID, Trade ID, Order ID, notes)
      if (filters.search) {
        const query = filters.search.toLowerCase();
        const stratName = strategies.find(s => s.id === tx.strategyId)?.name.toLowerCase() || '';
        const accName = accounts.find(a => a.id === tx.accountId)?.name.toLowerCase() || '';
        
        const matches = 
          tx.id.toLowerCase().includes(query) ||
          tx.symbol.toLowerCase().includes(query) ||
          tx.tradeId.toLowerCase().includes(query) ||
          tx.orderId.toLowerCase().includes(query) ||
          tx.notes.toLowerCase().includes(query) ||
          stratName.includes(query) ||
          accName.includes(query);

        if (!matches) return false;
      }

      return true;
    });
  }, [transactions, filters.search, strategies, accounts]);

  // Saved Filter Presets
  const applyPreset = (name: string, pFilters: Partial<TransactionFilters>) => {
    onUpdateFilters(prev => ({
      ...prev,
      ...pFilters
    }));
    setActivePreset(name);
  };

  const PRESETS = [
    { name: 'Live Crypto Buys', filters: { types: ['BUY'] as any, symbols: ['BTC/USD'], dateRange: 'all' as any } },
    { name: 'Executed Audits (7d)', filters: { statuses: ['EXECUTED'] as any, dateRange: '7d' as any } },
    { name: 'Flagged / Attention', filters: { search: 'flagged' } } // We can query flagged via search or build specific flags filters
  ];

  return (
    <div className="space-y-5">
      
      {/* Upper header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Transactions Ledger Audit</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Comprehensive chronological database of automated algorithmic and manual executions.
            {!txLoading && <span className="text-indigo-400 ml-1">{transactions.length} entries</span>}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* Refresh button */}
          <button
            id="refresh-ledger-btn"
            onClick={() => fetchTransactions(filters)}
            disabled={txLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${txLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Global search input */}
          <div className="relative flex-1 md:w-64 lg:w-80">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input
              id="global-ledger-search-input"
              type="text"
              value={filters.search}
              onChange={(e) => onUpdateFilters(prev => ({ ...prev, search: e.target.value }))}
              placeholder="Search ticker, strategy, broker ID..."
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 font-sans"
            />
            {filters.search && (
              <button
                onClick={() => handleRemoveChip('search')}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            id="toggle-advance-filters-btn"
            onClick={() => setShowAdvanceFilters(!showAdvanceFilters)}
            className={`p-2 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 ${
              showAdvanceFilters 
                ? 'bg-slate-800 border-slate-700 text-indigo-400' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>
        </div>
      </div>

      {/* Date Shortcuts toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800 font-sans">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <span>Quick Range:</span>
          <div className="flex gap-1 pl-1">
            {(['today', '7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                id={`date-shortcut-btn-${r}`}
                onClick={() => handleDateShortcut(r)}
                className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer ${
                  filters.dateRange === r 
                    ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : 'All time'}
              </button>
            ))}
          </div>
        </div>

        {/* Saved Presets */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Bookmark className="w-3.5 h-3.5 text-slate-500" />
          <span>Presets:</span>
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                id={`preset-btn-${p.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                onClick={() => applyPreset(p.name, p.filters)}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
                  activePreset === p.name 
                    ? 'bg-indigo-600/15 text-indigo-400 border-indigo-500/25' 
                    : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300 hover:border-slate-700'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced Multiselect Controls Panel */}
      {showAdvanceFilters && (
        <div id="advanced-filters-panel" className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4 animate-in slide-in-from-top duration-200 font-sans">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            
            {/* Accounts Multi-select */}
            <div className="space-y-1 text-xs">
              <label className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold">Accounts</label>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto bg-slate-900 p-1.5 rounded border border-slate-800">
                {accounts.map(acc => {
                  const isChecked = filters.accounts.includes(acc.id);
                  return (
                    <button
                      key={acc.id}
                      id={`filter-acc-${acc.id}`}
                      onClick={() => {
                        onUpdateFilters(prev => {
                          const accounts = prev.accounts.includes(acc.id)
                            ? prev.accounts.filter(id => id !== acc.id)
                            : [...prev.accounts, acc.id];
                          return { ...prev, accounts };
                        });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 border transition-colors ${
                        isChecked 
                          ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/25' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {isChecked && <Check className="w-2.5 h-2.5" />}
                      {acc.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Strategies Multi-select */}
            <div className="space-y-1 text-xs">
              <label className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold">Strategies</label>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto bg-slate-900 p-1.5 rounded border border-slate-800">
                {strategies.map(strat => {
                  const isChecked = filters.strategies.includes(strat.id);
                  return (
                    <button
                      key={strat.id}
                      id={`filter-strat-${strat.id}`}
                      onClick={() => {
                        onUpdateFilters(prev => {
                          const strategies = prev.strategies.includes(strat.id)
                            ? prev.strategies.filter(id => id !== strat.id)
                            : [...prev.strategies, strat.id];
                          return { ...prev, strategies };
                        });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 border transition-colors ${
                        isChecked 
                          ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/25' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {isChecked && <Check className="w-2.5 h-2.5" />}
                      {strat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Symbols Multi-select */}
            <div className="space-y-1 text-xs">
              <label className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold">Asset Tickers</label>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto bg-slate-900 p-1.5 rounded border border-slate-800 font-mono">
                {symbols.map(sym => {
                  const isChecked = filters.symbols.includes(sym.ticker);
                  return (
                    <button
                      key={sym.ticker}
                      id={`filter-sym-${sym.ticker.replace('/', '-')}`}
                      onClick={() => {
                        onUpdateFilters(prev => {
                          const symbols = prev.symbols.includes(sym.ticker)
                            ? prev.symbols.filter(t => t !== sym.ticker)
                            : [...prev.symbols, sym.ticker];
                          return { ...prev, symbols };
                        });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                        isChecked 
                          ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/25' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {isChecked && <Check className="w-2.5 h-2.5" />}
                      {sym.ticker}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Directions Toggle (BUY/SELL) */}
            <div className="space-y-1 text-xs">
              <label className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold">Directions</label>
              <div className="flex flex-col gap-1">
                {(['BUY', 'SELL'] as const).map(type => {
                  const isChecked = filters.types.includes(type);
                  return (
                    <label key={type} className="flex items-center gap-2 text-slate-300 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          onUpdateFilters(prev => {
                            const types = prev.types.includes(type)
                              ? prev.types.filter(t => t !== type)
                              : [...prev.types, type];
                            return { ...prev, types };
                          });
                        }}
                        className="rounded-sm border-slate-800 text-indigo-600 bg-slate-950 focus:ring-0 w-3.5 h-3.5"
                      />
                      <span className={`text-[11px] font-bold font-mono ${type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{type}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Statuses Toggle */}
            <div className="space-y-1 text-xs">
              <label className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold">Booking Status</label>
              <div className="flex flex-col gap-1">
                {(['EXECUTED', 'PENDING', 'CANCELLED'] as const).map(status => {
                  const isChecked = filters.statuses.includes(status);
                  return (
                    <label key={status} className="flex items-center gap-2 text-slate-300 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          onUpdateFilters(prev => {
                            const statuses = prev.statuses.includes(status)
                              ? prev.statuses.filter(s => s !== status)
                              : [...prev.statuses, status];
                            return { ...prev, statuses };
                          });
                        }}
                        className="rounded-sm border-slate-800 text-indigo-600 bg-slate-950 focus:ring-0 w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-slate-200">{status}</span>
                    </label>
                  );
                })}
              </div>
            </div>

          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end">
            <button
              id="clear-all-filters-advanced-btn"
              onClick={onResetFilters}
              className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs text-slate-400 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      )}

      {/* Active Filter Chips board */}
      {isFiltered && (
        <div id="filter-chips-board" className="flex flex-wrap items-center gap-1.5 p-2.5 bg-slate-950 rounded-md border border-slate-800 text-xs font-sans">
          <span className="text-slate-500 text-[10px] uppercase font-mono mr-1">Active Criteria:</span>
          
          {filters.search && (
            <span className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 font-mono text-[10px] flex items-center gap-1">
              Search: "{filters.search}"
              <button onClick={() => handleRemoveChip('search')} className="hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          )}

          {filters.accounts.map(accId => {
            const name = accounts.find(a => a.id === accId)?.name || accId;
            return (
              <span key={accId} className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 text-[10px] flex items-center gap-1">
                Account: {name}
                <button onClick={() => handleRemoveChip('accounts', accId)} className="hover:text-white"><X className="w-3 h-3" /></button>
              </span>
            );
          })}

          {filters.strategies.map(stratId => {
            const name = strategies.find(s => s.id === stratId)?.name || stratId;
            return (
              <span key={stratId} className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 text-[10px] flex items-center gap-1">
                Strategy: {name}
                <button onClick={() => handleRemoveChip('strategies', stratId)} className="hover:text-white"><X className="w-3 h-3" /></button>
              </span>
            );
          })}

          {filters.symbols.map(sym => (
            <span key={sym} className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 font-mono text-[10px] flex items-center gap-1">
              Symbol: {sym}
              <button onClick={() => handleRemoveChip('symbols', sym)} className="hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          ))}

          {filters.types.map(type => (
            <span key={type} className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 font-mono text-[10px] flex items-center gap-1">
              Type: {type}
              <button onClick={() => handleRemoveChip('types', type)} className="hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          ))}

          {filters.statuses.map(status => (
            <span key={status} className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 text-[10px] flex items-center gap-1">
              Status: {status}
              <button onClick={() => handleRemoveChip('statuses', status)} className="hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          ))}

          {filters.dateRange !== 'all' && (
            <span className="px-2 py-0.5 rounded-sm bg-indigo-950 text-indigo-400 font-mono text-[10px] flex items-center gap-1">
              Range: {filters.dateRange.toUpperCase()}
              <button onClick={() => handleRemoveChip('dateRange')} className="hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          )}

          <button
            id="clear-chips-btn"
            onClick={onResetFilters}
            className="text-[10px] font-mono text-slate-500 hover:text-slate-300 ml-auto font-bold pl-2"
          >
            Clear Filters
          </button>
        </div>
      )}

      {txError && (
        <div className="p-3 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-lg text-xs">
          Error loading ledger: {txError}
        </div>
      )}

      {/* Full Transaction list implementation */}
      {txLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-900/60 rounded-lg animate-pulse border border-slate-800" />
          ))}
        </div>
      ) : (
        <TransactionList
          transactions={filteredTransactions}
          accounts={accounts}
          strategies={strategies}
          variant="full"
          timezone={timezone}
          onRowClick={onSelectTransaction}
          highlightedTxId={highlightedTxId}
          sortConfigs={sortConfigs}
          onSortChange={setSortConfigs}
        />
      )}

    </div>
  );
}
