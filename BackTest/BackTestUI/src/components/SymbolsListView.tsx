/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  LineChart, Search, Plus, TrendingUp, TrendingDown, Activity, 
  Globe, Coins, X, ChevronRight, Sparkles, RefreshCw, Power
} from 'lucide-react';
import { SymbolData } from '../types';
import { api } from '../api';
import { mapSymbol } from '../adapters';

interface SymbolsListViewProps {
  symbols: SymbolData[]; // Parent state — used only for overview metrics
  onAddSymbol: (newSym: SymbolData) => void;
  onNavigateToEntity: (type: 'symbol', id: string) => void;
  onRefreshData?: () => Promise<void> | void;
  onToggleSymbolActive: (id: string, isActive: boolean) => void;
}

export default function SymbolsListView({
  symbols,
  onAddSymbol,
  onNavigateToEntity,
  onRefreshData,
  onToggleSymbolActive
}: SymbolsListViewProps) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'crypto' | 'equity' | 'forex'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

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
  const [instrumentClass, setInstrumentClass] = useState<'EQUITY' | 'CRYPTO' | 'FOREX' | 'INDEX'>('EQUITY');

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

  // Computed overview metrics (from parent unfiltered symbols prop)
  const activeCount = symbols.filter(s => s.isActive).length;
  const totalVolume = symbols.reduce((sum, s) => sum + s.volume24h, 0);
  const avgChange = symbols.reduce((sum, s) => sum + s.change24h, 0) / (symbols.length || 1);
  const topMover = [...symbols].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instrumentToken || !name || !exchange) return;

    const newSym: SymbolData = {
      ticker: instrumentToken.trim(),
      name,
      exchange: exchange.toUpperCase(),
      lastPrice: 100.0,
      change24h: 0.0,
      volume24h: 100000,
      instrumentType: (instrumentClass.toLowerCase() === 'equity' || instrumentClass.toLowerCase() === 'index' ? 'equity' : instrumentClass.toLowerCase()) as any,
      instrumentToken: instrumentToken.trim(),
      description,
      instrumentClass,
    };

    onAddSymbol(newSym);
    
    // Reset Form
    setName('');
    setExchange('NSE');
    setInstrumentToken('');
    setDescription('');
    setInstrumentClass('EQUITY');
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
            {(['all', 'crypto', 'equity', 'forex'] as const).map(type => (
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
                  const isPositive = sym.change24h >= 0;
                  const isToggling = togglingId === sym.id;
                  const liveSym = symbols.find(s => s.id === sym.id || s.instrumentToken === sym.instrumentToken);
                  const currentPrice = liveSym ? liveSym.lastPrice : sym.lastPrice;
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
                          sym.instrumentType === 'crypto' ? 'bg-amber-950/40 text-amber-400 border-amber-900/30' :
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
                        ₹{currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </td>
                      <td className="p-4 text-right">
                        <span className={`inline-flex items-center gap-1 font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {isPositive ? '+' : ''}{sym.change24h}%
                        </span>
                      </td>
                      <td className="p-4 text-right text-slate-400 font-mono">
                        ₹{sym.volume24h.toLocaleString()}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
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
                  <option value="EQUITY">Equity (Stock Share)</option>
                  <option value="CRYPTO">Cryptocurrency Pair</option>
                  <option value="FOREX">Forex Spot Contract</option>
                  <option value="INDEX">Index</option>
                </select>
              </div>

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

    </div>
  );
}

