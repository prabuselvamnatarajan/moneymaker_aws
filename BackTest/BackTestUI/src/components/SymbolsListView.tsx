/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  LineChart, Search, Plus, TrendingUp, TrendingDown, Activity, 
  Globe, Coins, X, ChevronRight, Sparkles, RefreshCw, Power,
  Edit, Trash2, AlertTriangle
} from 'lucide-react';
import { SymbolData } from '../types';
import { api } from '../api';
import { mapSymbol } from '../adapters';
import { getLiveQuote, tokensMatch, LiveQuote } from '../utils/instrumentToken';

interface SymbolsListViewProps {
  symbols: SymbolData[]; // Parent state — used only for overview metrics
  liveQuotes?: Record<string, LiveQuote>;
  onAddSymbol: (newSym: SymbolData) => void;
  onNavigateToEntity: (type: 'symbol', id: string) => void;
  onRefreshData?: () => Promise<void> | void;
  onToggleSymbolActive: (id: string, isActive: boolean) => void;
  onEditSymbol?: (id: string, updateData: any) => Promise<void> | void;
  onDeleteSymbol?: (id: string, ticker: string) => Promise<void> | void;
}

export default function SymbolsListView({
  symbols,
  liveQuotes = {},
  onAddSymbol,
  onNavigateToEntity,
  onRefreshData,
  onToggleSymbolActive,
  onEditSymbol,
  onDeleteSymbol
}: SymbolsListViewProps) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'equity' | 'index' | 'option'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Edit / Delete State
  const [editingSymbol, setEditingSymbol] = useState<SymbolData | null>(null);
  const [deletingSymbol, setDeletingSymbol] = useState<SymbolData | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');

  useEffect(() => {
    if (!deletingSymbol) {
      setDeleteConfirmInput('');
    }
  }, [deletingSymbol]);

  // Edit Form Fields
  const [editName, setEditName] = useState('');
  const [editExchange, setEditExchange] = useState('NSE');
  const [editInstrumentToken, setEditInstrumentToken] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstrumentClass, setEditInstrumentClass] = useState<'EQUITY' | 'INDEX' | 'OPTION'>('EQUITY');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editStrikePriceDiff, setEditStrikePriceDiff] = useState<number>(50);

  const handleOpenEdit = (sym: SymbolData) => {
    setEditingSymbol(sym);
    setEditName(sym.name);
    setEditExchange(sym.exchange);
    setEditInstrumentToken(sym.instrumentToken);
    setEditDescription(sym.description || '');
    setEditInstrumentClass((sym.instrumentClass || 'EQUITY') as any);
    setEditIsActive(sym.isActive);
    setEditStrikePriceDiff(sym.strikePriceDiff || 50);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSymbol || !onEditSymbol) return;
    try {
      await onEditSymbol(editingSymbol.id || editingSymbol.ticker, {
        symbol_name: editName,
        exchange: editExchange.toUpperCase(),
        instrument_token: editInstrumentToken.trim(),
        description: editDescription,
        instrument_class: editInstrumentClass,
        is_active: editIsActive,
        ...((editInstrumentClass === 'INDEX' || editInstrumentClass === 'EQUITY')
          ? { strike_price_diff: editStrikePriceDiff }
          : {}),
      });
      setEditingSymbol(null);
      await fetchTableData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSymbol || !onDeleteSymbol) return;
    try {
      await onDeleteSymbol(deletingSymbol.id || deletingSymbol.ticker, deletingSymbol.ticker);
      setDeletingSymbol(null);
      await fetchTableData();
    } catch (err) {
      console.error(err);
    }
  };

  // --- Self-fetched table data (server-side filtering) ---
  const [tableSymbols, setTableSymbols] = useState<SymbolData[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [exchange, setExchange] = useState('NSE');
  const [instrumentToken, setInstrumentToken] = useState('');
  const [description, setDescription] = useState('');
  const [instrumentClass, setInstrumentClass] = useState<'EQUITY' | 'INDEX' | 'OPTION'>('EQUITY');
  const [strikePriceDiff, setStrikePriceDiff] = useState<number>(50);

  // Bulk addition form fields
  const [bulkSymbol, setBulkSymbol] = useState('');
  const [rangeCount, setRangeCount] = useState(3);
  const [rangeOption, setRangeOption] = useState<'ITM' | 'ATM' | 'OTM' | 'ALL'>('ITM');
  const [optionType, setOptionType] = useState<'Call' | 'Put' | 'Both'>('Call');
  const [expiry, setExpiry] = useState(new Date().toISOString().split('T')[0]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Initialize/Reset expiry date when bulk modal opens
  useEffect(() => {
    if (showBulkModal) {
      setExpiry(new Date().toISOString().split('T')[0]);
    }
  }, [showBulkModal]);

  // Fetch filtered data from server
  const fetchTableData = useCallback(async () => {
    setTableLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter === 'active') params.is_active = 'true';
      else if (statusFilter === 'inactive') params.is_active = 'false';
      if (typeFilter !== 'all') params.instrument_class = typeFilter.toUpperCase();
      if (debouncedSearch) params.search = debouncedSearch;

      const res = await api.symbols.list(params);
      setTableSymbols(res.items.map(mapSymbol));
    } catch (err) {
      console.error('[SymbolsListView] Failed to fetch symbols:', err);
    } finally {
      setTableLoading(false);
    }
  }, [statusFilter, typeFilter, debouncedSearch]);

  // Re-fetch when filters change
  useEffect(() => {
    fetchTableData();
  }, [fetchTableData]);

  // Handle refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchTableData();
      if (onRefreshData) await onRefreshData();
    } finally {
      setRefreshing(false);
    }
  };

  // Handle toggle active/inactive — calls parent handler, then re-fetches table
  const handleToggleActive = async (id: string, isActive: boolean) => {
    setTogglingId(id);
    try {
      onToggleSymbolActive(id, isActive);
      // Allow the parent API call to process, then re-fetch server-filtered table
      await new Promise(r => setTimeout(r, 400));
      await fetchTableData();
    } finally {
      setTogglingId(null);
    }
  };

  // Computed overview metrics — prefer live quotes when available
  const enrichedSymbols = symbols.map(s => {
    const q = getLiveQuote(liveQuotes, s.instrumentToken || '');
    return {
      ...s,
      lastPrice: q?.lastPrice ?? s.lastPrice,
      change24h: q?.change24h ?? s.change24h,
      volume24h: q?.volume24h ?? s.volume24h,
    };
  });
  const activeCount = enrichedSymbols.filter(s => s.isActive).length;
  const totalVolume = enrichedSymbols.reduce((sum, s) => sum + (s.volume24h || 0), 0);
  const avgChange = enrichedSymbols.reduce((sum, s) => sum + (s.change24h || 0), 0) / (enrichedSymbols.length || 1);
  const topMover = [...enrichedSymbols].sort((a, b) => Math.abs(b.change24h || 0) - Math.abs(a.change24h || 0))[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instrumentToken || !name || !exchange) return;
    if ((instrumentClass === 'INDEX' || instrumentClass === 'EQUITY') && !(strikePriceDiff > 0)) return;

    const newSym: SymbolData = {
      ticker: instrumentToken.trim(),
      name,
      exchange: exchange.toUpperCase(),
      lastPrice: 0,
      change24h: 0,
      volume24h: 0,
      instrumentType: instrumentClass.toLowerCase() as 'equity' | 'index' | 'option',
      instrumentToken: instrumentToken.trim(),
      description,
      instrumentClass,
      strikePriceDiff:
        instrumentClass === 'INDEX' || instrumentClass === 'EQUITY' ? strikePriceDiff : null,
    };

    onAddSymbol(newSym);
    
    // Reset Form
    setName('');
    setExchange('NSE');
    setInstrumentToken('');
    setDescription('');
    setInstrumentClass('EQUITY');
    setStrikePriceDiff(50);
    setShowAddForm(false);
    // Re-fetch table after adding
    setTimeout(() => fetchTableData(), 500);
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkSymbol) {
      setBulkError('Please select a symbol');
      return;
    }
    setBulkLoading(true);
    setBulkError(null);
    setBulkSuccess(null);

    try {
      const res = await api.symbols.bulkCreate({
        symbol: bulkSymbol,
        range_count: rangeOption === 'ATM' ? 1 : rangeCount,
        range_option: rangeOption,
        option_type: optionType,
        expiry: expiry || undefined,
      });
      setBulkSuccess(res.message);
      // Re-fetch symbols
      await fetchTableData();
      if (onRefreshData) await onRefreshData();
      
      // Auto close after 2 seconds
      setTimeout(() => {
        setShowBulkModal(false);
        setBulkSuccess(null);
        setBulkSymbol('');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to add bulk symbols:', err);
      setBulkError(err.message || 'An error occurred while adding bulk symbols');
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <LineChart className="w-5 h-5 text-indigo-400" />
            Tracked Assets & Market Indices
          </h2>
          <p className="text-xs text-slate-500">
            Configure real-time pricing feeds, trading exchanges, and instrument indices ingested by CobraTrades.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2 shrink-0 self-start sm:self-center">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
            title="Refresh symbols list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="relative">
            <button
              id="btn-track-symbol-trigger"
              onClick={() => setShowDropdown(prev => !prev)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 shrink-0"
            >
              <Plus className="w-4 h-4" /> Track New Asset
            </button>
            {showDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-md shadow-xl z-50 divide-y divide-slate-800 animate-in fade-in slide-in-from-top-2 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(true);
                      setShowDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    Track Single Asset
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkModal(true);
                      setShowDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    Add Bulk Symbols
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Overview Analytics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 font-sans">
        
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold font-sans">Assets Engaged</p>
          <p className="text-xl font-black font-mono text-slate-100 mt-1.5">
            <span className="text-emerald-400">{activeCount}</span>
            <span className="text-slate-600 mx-0.5">/</span>
            {symbols.length} <span className="text-xs text-slate-500 font-normal">Active Feeds</span>
          </p>
          <div className="mt-1.5 w-full h-1 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${symbols.length > 0 ? (activeCount / symbols.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Average 24h Swing</p>
          <p className={`text-xl font-black font-mono mt-1.5 ${avgChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Aggregated Daily Volume</p>
          <p className="text-xl font-bold font-mono text-indigo-400 mt-1.5">
            ₹{(totalVolume / 1e9).toFixed(1)}B <span className="text-[9px] text-slate-500 font-normal">Est</span>
          </p>
        </div>

        {topMover && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Highest Velocity Asset</p>
            <p className="text-xl font-bold font-mono text-slate-100 mt-1.5 flex items-center gap-2">
              <span className="text-indigo-400">{topMover.ticker}</span>
              <span className={`text-xs ${topMover.change24h >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {topMover.change24h >= 0 ? '▲' : '▼'} {Math.abs(topMover.change24h)}%
              </span>
            </p>
          </div>
        )}

      </div>

      {/* Filters & Navigation Hub */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800 font-sans">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tracked assets by symbol ticker, friendly name, exchange provider..."
            className="w-full bg-slate-900 border border-slate-800 rounded-md pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 font-sans"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold px-2">Type:</span>
          <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-850">
            {(['all', 'equity', 'index', 'option'] as const).map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                  typeFilter === type 
                    ? 'bg-slate-850 text-indigo-400 font-bold' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-bold px-2">Status:</span>
          <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-850">
            {(['all', 'active', 'inactive'] as const).map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                  statusFilter === status 
                    ? 'bg-slate-850 text-indigo-400 font-bold' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Symbols Records Table */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden font-sans">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
          <span className="text-xs font-bold text-slate-300 font-sans">
            Asset Pricing Feeds Directory
            {!tableLoading && <span className="text-indigo-400 ml-1">({tableSymbols.length})</span>}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {tableLoading ? 'Fetching from server...' : 'Server-filtered results'}
          </span>
        </div>

        {tableLoading ? (
          /* Loading skeleton */
          <div className="p-2 space-y-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 bg-slate-900/60 rounded-lg animate-pulse border border-slate-800/40" />
            ))}
          </div>
        ) : tableSymbols.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-800/60 select-none min-w-[900px]">
              <thead className="bg-slate-900/50 text-slate-500 uppercase font-semibold font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="p-4">Ticker / Asset Name</th>
                  <th className="p-4">Exchange Platform</th>
                  <th className="p-4">Instrument Class</th>
                  <th className="p-4 font-mono">Status</th>
                  <th className="p-4 text-right">Last price quote</th>
                  <th className="p-4 text-right">24h Market Swing</th>
                  <th className="p-4 text-right">Trading Volume (24h)</th>
                  <th className="p-4 text-center">Workloads Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {tableSymbols.map(sym => {
                  const liveSym = symbols.find(s =>
                    s.id === sym.id || tokensMatch(s.instrumentToken || '', sym.instrumentToken || '')
                  );
                  const quote = getLiveQuote(liveQuotes, sym.instrumentToken || '');
                  const currentPrice =
                    quote?.lastPrice ??
                    (liveSym ? liveSym.lastPrice : sym.lastPrice);
                  const currentChange =
                    quote?.change24h ??
                    (liveSym ? liveSym.change24h : sym.change24h);
                  const currentVolume =
                    quote?.volume24h ??
                    (liveSym ? liveSym.volume24h : sym.volume24h);
                  const isPositive = (currentChange ?? 0) >= 0;
                  const isToggling = togglingId === sym.id;
                  const hasPrice = currentPrice != null && currentPrice > 0;
                  return (
                    <tr key={sym.id || sym.ticker} className="hover:bg-indigo-600/5 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-black font-mono text-slate-100 hover:text-indigo-400 cursor-pointer" onClick={() => onNavigateToEntity('symbol', sym.ticker)}>
                            {sym.ticker}
                          </span>
                          <span className="text-xs text-slate-400 truncate max-w-[150px] font-sans">
                            {sym.name}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-400 font-mono font-medium">{sym.exchange}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[9px] font-mono tracking-wider font-bold uppercase border ${
                          sym.instrumentType === 'option' ? 'bg-amber-950/40 text-amber-400 border-amber-900/30' :
                          sym.instrumentType === 'equity' ? 'bg-indigo-950/40 text-indigo-400 border-indigo-900/30' :
                          'bg-emerald-950/40 text-emerald-400 border-emerald-900/30'
                        }`}>
                          {sym.instrumentType}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono tracking-wider font-bold uppercase border ${
                          sym.isActive 
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30' 
                            : 'bg-slate-950/40 text-slate-450 border-slate-800/30'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sym.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                          {sym.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold font-mono text-slate-200">
                        {hasPrice
                          ? `₹${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                          : '—'}
                      </td>
                      <td className="p-4 text-right">
                        {quote?.change24h != null || (currentChange != null && currentChange !== 0) ? (
                          <span className={`inline-flex items-center gap-1 font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                            {isPositive ? '+' : ''}{(currentChange ?? 0).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right text-slate-400 font-mono">
                        {currentVolume != null && currentVolume > 0
                          ? currentVolume.toLocaleString()
                          : '—'}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {onEditSymbol && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEdit(sym);
                              }}
                              className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-md transition-colors cursor-pointer"
                              title="Edit Symbol"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onDeleteSymbol && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingSymbol(sym);
                              }}
                              className="p-1.5 text-rose-450 hover:text-rose-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-md transition-colors cursor-pointer"
                              title="Delete Symbol"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => onNavigateToEntity('symbol', sym.ticker)}
                            className="px-2.5 py-1 text-slate-500 hover:text-slate-200 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded transition-all text-[11px] font-semibold cursor-pointer"
                          >
                            Audit Chart
                          </button>
                          <button
                            disabled={isToggling}
                            onClick={() => {
                              if (sym.id) {
                                handleToggleActive(sym.id, !sym.isActive);
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded transition-all text-[11px] font-semibold cursor-pointer border disabled:opacity-50 ${
                              sym.isActive
                                ? 'text-rose-400 hover:text-rose-300 bg-rose-950/20 border-rose-900/30 hover:bg-rose-900/20'
                                : 'text-emerald-400 hover:text-emerald-300 bg-emerald-950/20 border-emerald-900/30 hover:bg-emerald-900/20'
                            }`}
                          >
                            <Power className={`w-3 h-3 ${isToggling ? 'animate-spin' : ''}`} />
                            {sym.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500">
            No tracked symbols matched your filters or search criteria.
          </div>
        )}
      </div>

      {/* Add Symbol Overlay popup */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <LineChart className="w-4 h-4 text-indigo-400" />
                Track New Market Asset
              </h3>
              <button 
                onClick={() => setShowAddForm(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

             <form onSubmit={handleSubmit} className="p-6 space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Instrument Token</label>
                  <input
                    type="text"
                    required
                    value={instrumentToken}
                    onChange={(e) => setInstrumentToken(e.target.value)}
                    placeholder="e.g. INFy, AAPL, BTC/USD"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Exchange / Feed Provider</label>
                  <input
                    type="text"
                    required
                    value={exchange}
                    onChange={(e) => setExchange(e.target.value)}
                    placeholder="e.g. NSE, BSE, NFO"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Symbol Name (UI Display)</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Infosys Technologies Ltd"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Instrument Class</label>
                <select
                  value={instrumentClass}
                  onChange={(e) => setInstrumentClass(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-805 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="EQUITY">Equity</option>
                  <option value="INDEX">Index</option>
                  <option value="OPTION">Option</option>
                </select>
              </div>

              {(instrumentClass === 'INDEX' || instrumentClass === 'EQUITY') && (
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Strike Price Diff</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={strikePriceDiff}
                    onChange={(e) => setStrikePriceDiff(parseInt(e.target.value, 10) || 0)}
                    placeholder="e.g. 50 for Nifty, 100 for Bank Nifty"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500">Strike spacing used for dynamic option symbol control (Nifty=50, Bank Nifty=100).</p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Description (Optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Large cap IT service provider listed on National Stock Exchange of India"
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Confirm Asset Feed
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                Add Bulk Option Symbols
              </h3>
              <button 
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBulkSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {bulkError && (
                <div className="p-3 rounded-md bg-rose-950/40 border border-rose-900/50 text-rose-450 text-xs font-medium">
                  {bulkError}
                </div>
              )}
              {bulkSuccess && (
                <div className="p-3 rounded-md bg-emerald-950/40 border border-emerald-900/50 text-emerald-450 text-xs font-medium">
                  {bulkSuccess}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Choose Underlying Asset</label>
                <select
                  required
                  value={bulkSymbol}
                  onChange={(e) => setBulkSymbol(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-mono"
                >
                  <option value="">Select active asset...</option>
                  {tableSymbols
                    .filter(s => s.isActive && (s.instrumentClass === 'INDEX' || s.instrumentClass === 'EQUITY'))
                    .map(sym => (
                      <option key={sym.id || sym.ticker} value={sym.ticker}>
                        {sym.ticker} ({sym.name})
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-505">Only active index or equity assets can fetch option chains.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Expiry Date</label>
                <input
                  type="date"
                  required
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Range Option</label>
                  <select
                    value={rangeOption}
                    onChange={(e) => setRangeOption(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="ITM">ITM (In The Money)</option>
                    <option value="ATM">ATM (At The Money)</option>
                    <option value="OTM">OTM (Out of The Money)</option>
                    <option value="ALL">ALL (ITM + ATM + OTM)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Option Type</label>
                  <select
                    value={optionType}
                    onChange={(e) => setOptionType(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="Call">Call (CE Only)</option>
                    <option value="Put">Put (PE Only)</option>
                    <option value="Both">Both (CE & PE)</option>
                  </select>
                </div>
              </div>

              {rangeOption !== 'ATM' && (
                <div className="space-y-1 animate-in fade-in duration-200">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Range Count</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={20}
                    value={rangeCount}
                    onChange={(e) => setRangeCount(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-505">Specifies how many strike levels in each direction to import.</p>
                </div>
              )}

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                  disabled={bulkLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkLoading || !bulkSymbol}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {bulkLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                  {bulkLoading ? 'Adding Options...' : 'Fetch & Add Chain'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    {/* Edit Symbol Modal */}
      {editingSymbol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Edit className="w-4 h-4 text-indigo-400" />
                Edit Asset Feed
              </h3>
              <button 
                onClick={() => setEditingSymbol(null)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 text-slate-200">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Friendly Asset Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Exchange Platform</label>
                  <select
                    value={editExchange}
                    onChange={(e) => setEditExchange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                  >
                    <option value="NSE">NSE (National Stock Exchange)</option>
                    <option value="BSE">BSE (Bombay Stock Exchange)</option>
                    <option value="BINANCE">BINANCE (Crypto Exchange)</option>
                    <option value="FOREX">FOREX (Foreign Exchange)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Instrument Class</label>
                  <select
                    value={editInstrumentClass}
                    onChange={(e) => setEditInstrumentClass(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                  >
                    <option value="EQUITY">Equity</option>
                    <option value="INDEX">Index</option>
                    <option value="OPTION">Option</option>
                  </select>
                </div>
              </div>

              {(editInstrumentClass === 'INDEX' || editInstrumentClass === 'EQUITY') && (
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Strike Price Diff</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={editStrikePriceDiff}
                    onChange={(e) => setEditStrikePriceDiff(parseInt(e.target.value, 10) || 0)}
                    className="w-full bg-slate-955 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-mono"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Instrument Token / Ticker</label>
                <input
                  type="text"
                  required
                  value={editInstrumentToken}
                  onChange={(e) => setEditInstrumentToken(e.target.value)}
                  className="w-full bg-slate-955 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Notes / Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 h-20 resize-none"
                />
              </div>

              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="edit-sym-is-active"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-3.5 h-3.5 bg-slate-955 border-slate-800 rounded focus:ring-0 text-indigo-600 focus:ring-offset-0"
                />
                <label htmlFor="edit-sym-is-active" className="text-xs text-slate-350 select-none cursor-pointer">
                  Activate Live Feed Subscription
                </label>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingSymbol(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Update Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Symbol Confirmation Warning */}
      {deletingSymbol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-955/90 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-rose-955 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6 bg-rose-950/20 border-b border-rose-900/30 flex items-center gap-3">
              <div className="p-2 bg-rose-900/30 rounded-lg text-rose-455">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-200 uppercase tracking-wider font-mono">
                  Delete Asset Feed
                </h3>
                <p className="text-[10px] text-rose-400 font-medium">Critical Action Required</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-350 space-y-3 leading-relaxed">
                <p>
                  You are about to permanently delete asset subscription <strong className="text-white font-semibold font-mono">{deletingSymbol.ticker}</strong> ({deletingSymbol.name}).
                </p>
                <div className="p-3.5 bg-rose-950/30 border border-rose-900/30 rounded-lg text-rose-350 space-y-2">
                  <p className="font-bold text-[10px] uppercase font-mono tracking-wider flex items-center gap-1 text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5" /> Permanent Cascading Impact
                  </p>
                  <p className="text-[11px] text-rose-350">
                    Deleting this asset feed will permanently delete:
                  </p>
                  <ul className="list-disc pl-5 text-[11px] text-rose-300 space-y-1 font-medium">
                    <li>This asset's subscription and telemetry history</li>
                    <li>All deployments targetting this asset token</li>
                    <li>All historical trades, transactions, and positions for those deployments</li>
                  </ul>
                </div>
                <p className="text-[11px] text-slate-400">
                  Please type the symbol ticker <span className="font-mono text-white select-all bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">{deletingSymbol.ticker}</span> below to confirm.
                </p>
              </div>

              <input
                type="text"
                placeholder="Type symbol ticker to confirm"
                value={deleteConfirmInput}
                className="w-full bg-slate-950 border border-rose-900/30 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-rose-500 font-mono"
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
              />

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setDeletingSymbol(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete-symbol"
                  disabled={deleteConfirmInput !== deletingSymbol.ticker}
                  onClick={handleDeleteConfirm}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

