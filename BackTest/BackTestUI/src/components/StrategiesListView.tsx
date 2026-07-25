/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Cpu, Search, Plus, Play, Pause, Square, Activity, TrendingUp, 
  BarChart2, DollarSign, Globe, X, ChevronRight, AlertTriangle, RefreshCw,
  Edit, Trash2
} from 'lucide-react';
import { Strategy, SymbolData, Account } from '../types';

interface StrategiesListViewProps {
  strategies: Strategy[];
  symbols: SymbolData[];
  accounts: Account[];
  strategyDefinitions?: any[];
  onAddStrategy: (
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
  ) => void;
  onUpdateStrategyStatus: (id: string, status: 'active' | 'paused' | 'stopped') => void;
  onNavigateToEntity: (type: 'strategy', id: string) => void;
  onRefreshData?: () => Promise<void> | void;
  onEditStrategy?: (id: string, updateData: any) => Promise<void> | void;
  onDeleteStrategy?: (id: string) => Promise<void> | void;
}

export default function StrategiesListView({
  strategies,
  symbols,
  accounts,
  strategyDefinitions = [],
  onAddStrategy,
  onUpdateStrategyStatus,
  onNavigateToEntity,
  onRefreshData,
  onEditStrategy,
  onDeleteStrategy
}: StrategiesListViewProps) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Edit / Delete state
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [deletingStrategy, setDeletingStrategy] = useState<Strategy | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');

  useEffect(() => {
    if (!deletingStrategy) {
      setDeleteConfirmInput('');
    }
  }, [deletingStrategy]);

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBacktestDate, setEditBacktestDate] = useState('');
  const [editBacktestSpeed, setEditBacktestSpeed] = useState<number>(1000);
  const [editUseFullAmount, setEditUseFullAmount] = useState(false);
  const [editNoOfLots, setEditNoOfLots] = useState<number>(1);
  const [editTimeframe, setEditTimeframe] = useState<'1m' | '3m' | '5m' | '15m'>('1m');

  const handleOpenEdit = (strat: Strategy) => {
    setEditingStrategy(strat);
    setEditName(strat.name);
    setEditDescription(strat.description || '');
    setEditBacktestDate(strat.backtestDate || '');
    setEditBacktestSpeed(strat.backtestSpeed || 1000);
    setEditUseFullAmount(strat.useFullAmount || false);
    setEditNoOfLots(strat.noOfLots || 1);
    setEditTimeframe((strat.timeframe as any) || '1m');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStrategy || !onEditStrategy) return;
    try {
      await onEditStrategy(editingStrategy.id, {
        deployment_name: editName,
        notes: editDescription,
        timeframe: editTimeframe,
        backtest_date: editingStrategy.mode === 'backtest' ? editBacktestDate : undefined,
        backtest_speed: editingStrategy.mode === 'backtest' ? editBacktestSpeed : undefined,
        use_full_amount: editUseFullAmount,
        ...(editingStrategy.lotSize != null ? { no_of_lots: editNoOfLots } : {}),
      });
      setEditingStrategy(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingStrategy || !onDeleteStrategy) return;
    try {
      await onDeleteStrategy(deletingStrategy.id);
      setDeletingStrategy(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefresh = async () => {
    if (onRefreshData) {
      setRefreshing(true);
      try {
        await onRefreshData();
      } finally {
        setRefreshing(false);
      }
    }
  };
  
  // Form fields for deployment creation
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [deploymentName, setDeploymentName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'live' | 'paper' | 'backtest'>('live');
  const [selectedSymbolId, setSelectedSymbolId] = useState('');
  const [initialStatus, setInitialStatus] = useState<'active' | 'paused' | 'stopped'>('active');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [backtestDate, setBacktestDate] = useState(new Date().toISOString().slice(0, 10));
  const [backtestSpeed, setBacktestSpeed] = useState(1000);
  const [timeframe, setTimeframe] = useState<'1m' | '3m' | '5m' | '15m'>('1m');
  const [useFullAmount, setUseFullAmount] = useState(false);
  const [noOfLots, setNoOfLots] = useState(1);
  const [dynamicLotSize, setDynamicLotSize] = useState(50);
  const [dynamicSymbol, setDynamicSymbol] = useState(false);
  const [underlyingSymbolId, setUnderlyingSymbolId] = useState('');
  const [moneyness, setMoneyness] = useState<'ITM' | 'ATM' | 'OTM'>('ITM');
  const [offset, setOffset] = useState(1);
  const [optionType, setOptionType] = useState<'CE' | 'PE'>('CE');
  const [optionExpiry, setOptionExpiry] = useState(new Date().toISOString().slice(0, 10));

  /** Active underlyings for dynamic symbol control — all non-OPTION symbols. */
  const underlyingCandidates = symbols.filter(
    (s) => s.isActive && String(s.instrumentClass || '').toUpperCase() !== 'OPTION'
  );

  const activeSymbols = symbols.filter((s) => s.isActive);
  const selectedSymbol = activeSymbols.find((s) => s.id === selectedSymbolId);
  const selectedLotSize = selectedSymbol?.lotSize != null ? Number(selectedSymbol.lotSize) : null;
  const showLotSizing =
    dynamicSymbol ||
    (selectedSymbol != null &&
      (String(selectedSymbol.instrumentClass || '').toUpperCase() === 'OPTION' ||
        selectedLotSize != null && selectedLotSize > 0));

  // Computed metrics
  const visibleStrategies = strategies.filter(s => s.name.toLowerCase() !== 'manual');

  const totalPnl = visibleStrategies.reduce((sum, s) => sum + s.pnl, 0);
  const activeCount = visibleStrategies.filter(s => s.status === 'active').length;
  const strategiesWithTrades = visibleStrategies.filter(s => s.totalTrades > 0);
  const avgWinRate = strategiesWithTrades.length > 0
    ? strategiesWithTrades.reduce((sum, s) => sum + s.winRate, 0) / strategiesWithTrades.length
    : 0;
  const totalOpenPositions = visibleStrategies.reduce((sum, s) => sum + s.openPositions, 0);

  const filteredStrategies = visibleStrategies.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase()) ||
    s.symbols.some(sym => sym.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deploymentName || !selectedAccountId || !selectedStrategyId) return;
    if (dynamicSymbol && !underlyingSymbolId) return;
    if (dynamicSymbol && !/^\d{4}-\d{2}-\d{2}$/.test(optionExpiry)) return;
    if (dynamicSymbol && !(dynamicLotSize > 0)) return;
    if (!dynamicSymbol && !selectedSymbolId) return;
    if (showLotSizing && !useFullAmount && !(noOfLots >= 1)) return;

    const found = strategyDefinitions.find(s => s._id === selectedStrategyId);
    const targetStrategyName = found ? found.strategy_name : 'Algorithmic Strategy';
    const underlying = underlyingCandidates.find((s) => s.id === underlyingSymbolId);
    const resolvedLotSize = dynamicSymbol
      ? dynamicLotSize
      : selectedLotSize != null && selectedLotSize > 0
        ? selectedLotSize
        : null;

    const newStrat: Strategy = {
      id: `STRAT-0${strategies.length + 1}`,
      name: deploymentName,
      mode,
      status: initialStatus,
      pnl: 0,
      totalTrades: 0,
      winRate: 50.0,
      lastDeployTime: new Date().toISOString(),
      openPositions: 0,
      symbols: dynamicSymbol
        ? [underlying?.ticker || 'DYNAMIC']
        : selectedSymbol
          ? [selectedSymbol.ticker]
          : ['NSE_INDEX|Nifty 50'],
      description: description || `Deployed ${targetStrategyName} bot workload.`,
      backtestDate: mode === 'backtest' ? backtestDate : undefined,
      backtestSpeed: mode === 'backtest' ? backtestSpeed : undefined,
      useFullAmount: useFullAmount,
      lotSize: resolvedLotSize,
      noOfLots: showLotSizing ? noOfLots : 1,
      timeframe: timeframe,
    };

    const targetSymbol = selectedSymbol?.ticker || 'NSE_INDEX|Nifty 50';
    onAddStrategy(
      newStrat,
      selectedAccountId,
      targetSymbol,
      selectedStrategyId,
      dynamicSymbol
        ? {
            enabled: true,
            underlyingUserSymbolId: underlyingSymbolId,
            moneyness,
            offset: moneyness === 'ATM' ? 1 : offset,
            optionType,
            expiry: optionExpiry,
          }
        : undefined,
      {
        lotSize: resolvedLotSize,
        noOfLots: showLotSizing ? noOfLots : 1,
      }
    );
    
    // Reset Form
    setDeploymentName('');
    setDescription('');
    setMode('live');
    setSelectedSymbolId('');
    setInitialStatus('active');
    setSelectedAccountId('');
    setSelectedStrategyId('');
    setTimeframe('1m');
    setUseFullAmount(false);
    setNoOfLots(1);
    setDynamicLotSize(50);
    setDynamicSymbol(false);
    setUnderlyingSymbolId('');
    setMoneyness('ITM');
    setOffset(1);
    setOptionType('CE');
    setOptionExpiry(new Date().toISOString().slice(0, 10));
    setShowAddForm(false);
  };



  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            Active Algorithmic Strategy Deployments
          </h2>
          <p className="text-xs text-slate-500">
            Deploy, backtest, configure, and override active mathematical models executing across multi-broker endpoints.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2 shrink-0 self-start sm:self-center">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
            title="Refresh strategies list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            id="btn-deploy-strategy-trigger"
            onClick={() => setShowAddForm(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10"
          >
            <Plus className="w-4 h-4" /> Deploy Strategy
          </button>
        </div>
      </div>

      {/* Aggregate metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 font-sans">
        
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Total Cumulative Yield</p>
          <p className={`text-xl font-black font-mono mt-1.5 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 0 })}
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold font-sans">Active Server Workloads</p>
          <p className="text-xl font-black font-mono text-slate-100 mt-1.5">
            {activeCount} / {strategies.length} <span className="text-xs text-slate-500 font-normal">Engaged</span>
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Mean Success Win-Rate</p>
          <p className="text-xl font-bold font-mono text-slate-100 mt-1.5">
            {avgWinRate.toFixed(1)}% <span className="text-[10px] text-slate-500">Avg</span>
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Open Exposed Positions</p>
          <p className="text-xl font-bold font-mono text-indigo-400 mt-1.5">
            {totalOpenPositions} <span className="text-[10px] text-slate-500">Securities Held</span>
          </p>
        </div>

      </div>

      {/* Filters search */}
      <div className="flex items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search strategies by title, tags, description, targeted symbols..."
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
      </div>

      {/* Strategies Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 font-sans">
        {filteredStrategies.length > 0 ? (
          filteredStrategies.map(strat => {
            const isPnlPositive = strat.pnl >= 0;
            return (
              <div 
                key={strat.id}
                className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 group-hover:text-indigo-400 transition-colors cursor-pointer" onClick={() => onNavigateToEntity('strategy', strat.id)}>
                          {strat.name}
                        </span>
                        <span className="text-[9px] font-mono bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded border border-slate-800">
                          {strat.id}
                        </span>
                      </div>
                      
                      {/* Strategy mode and status info */}
                      <div className="flex items-center gap-2.5">
                        <span className={`text-[9px] font-black tracking-wider uppercase px-2 py-0.5 rounded-sm font-mono border ${
                          strat.mode === 'live' 
                            ? 'bg-rose-950/40 text-rose-400 border-rose-900/30' 
                            : 'bg-indigo-950/40 text-indigo-400 border-indigo-900/30'
                        }`}>
                          {strat.mode} deployment
                        </span>
                        <span className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm font-mono border bg-slate-900 text-cyan-400 border-slate-700/60">
                          {strat.timeframe || '1m'} Candle
                        </span>
                        {strat.symbolControl?.enabled && (
                          <span className="text-[9px] font-black tracking-wider uppercase px-2 py-0.5 rounded-sm font-mono border bg-violet-950/40 text-violet-300 border-violet-900/30">
                            {strat.symbolControl.moneyness}-{strat.symbolControl.offset} {strat.symbolControl.optionType}
                            {strat.symbolControl.lastResolvedStrike != null
                              ? ` @${strat.symbolControl.lastResolvedStrike}`
                              : ''}
                          </span>
                        )}

                        <span className={`w-1.5 h-1.5 rounded-full ${
                          strat.status === 'active' ? 'bg-emerald-500 animate-pulse' :
                          strat.status === 'paused' ? 'bg-amber-500' : 'bg-rose-500'
                        }`} />
                        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">{strat.status}</span>
                      </div>
                    </div>

                    {/* Quick Start/Pause control buttons */}
                    <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800/80">
                      <button
                        title="Start Strategy"
                        onClick={() => onUpdateStrategyStatus(strat.id, 'active')}
                        className={`p-1.5 rounded-md transition-all cursor-pointer ${strat.status === 'active' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                      <button
                        title="Pause Strategy"
                        onClick={() => onUpdateStrategyStatus(strat.id, 'paused')}
                        className={`p-1.5 rounded-md transition-all cursor-pointer ${strat.status === 'paused' ? 'bg-amber-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      </button>
                      <button
                        title="Terminate Workload"
                        onClick={() => onUpdateStrategyStatus(strat.id, 'stopped')}
                        className={`p-1.5 rounded-md transition-all cursor-pointer ${strat.status === 'stopped' ? 'bg-red-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 mt-3 line-clamp-2 leading-relaxed">
                    {strat.description}
                  </p>

                  {/* Targeted tickers symbols list */}
                  <div className="flex items-center gap-2 mt-4">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">Target Asset Classes:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {strat.symbols.map(sym => {
                        const matchedSym = symbols.find(s => s.ticker === sym || s.instrumentToken === sym);
                        const displayName = matchedSym ? (matchedSym.name || matchedSym.ticker) : sym;
                        return (
                          <span key={sym} className="text-[10px] font-mono text-indigo-300 bg-indigo-500/5 border border-indigo-500/10 px-2 py-0.5 rounded-sm" title={sym}>
                            {displayName}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 border-t border-slate-900/85 pt-4 mt-5">
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Workload Return</p>
                    <p className={`text-sm font-bold font-mono ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPnlPositive ? '+' : ''}₹{strat.pnl.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                    </p>
                  </div>

                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Win Ratio</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold font-mono text-slate-200">{strat.winRate}%</span>
                      <div className="w-12 h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${strat.winRate}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    {onEditStrategy && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEdit(strat);
                        }}
                        className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-md transition-colors cursor-pointer"
                        title="Edit Deployment"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onDeleteStrategy && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingStrategy(strat);
                        }}
                        className="p-1.5 text-rose-400 hover:text-rose-350 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-md transition-colors cursor-pointer"
                        title="Delete Deployment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onNavigateToEntity('strategy', strat.id)}
                      className="p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg transition-all flex items-center gap-1 text-xs cursor-pointer group-hover:translate-x-0.5"
                    >
                      Inspect <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })
        ) : (
          <div className="col-span-1 md:col-span-2 p-12 bg-slate-950 border border-slate-800 rounded-xl text-center text-slate-500 font-sans">
            No algorithm deployments matched your search queries.
          </div>
        )}
      </div>

      {/* Deploy strategy popup overlay */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900 z-10">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Cpu className="w-4 h-4 text-indigo-400" />
                Deploy Strategy template
              </h3>
              <button 
                onClick={() => setShowAddForm(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Strategy Template</label>
                <select
                  required
                  value={selectedStrategyId}
                  onChange={(e) => setSelectedStrategyId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="">Select Strategy Template...</option>
                  {strategyDefinitions
                    .filter(s => s.strategy_name.toLowerCase() !== 'manual')
                    .map(s => (
                      <option key={s._id} value={s._id}>{s.strategy_name}</option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Deployment Display Name</label>
                <input
                  type="text"
                  required
                  value={deploymentName}
                  onChange={(e) => setDeploymentName(e.target.value)}
                  placeholder="e.g. Bollinger Bands Live Run 1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Deployment Notes / Description</label>
                <textarea
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detail the algorithmic triggers, entry ranges, indicator bounds, and safety stops..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Target Brokerage Account</label>
                <select
                  required
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="">Select Account...</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} (₹{acc.balance.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Deployment Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="live">Live Workload (Broker Routing)</option>
                    <option value="paper">Paper Trading (Live Simulation)</option>
                    <option value="backtest">Backtest Engine (Historical Audit)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Candle Timeframe</label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500 font-mono"
                  >
                    <option value="1m">1 minute (1m)</option>
                    <option value="3m">3 minute (3m)</option>
                    <option value="5m">5 minute (5m)</option>
                    <option value="15m">15 minute (15m)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Initial Execution State</label>
                  <select
                    value={initialStatus}
                    onChange={(e) => setInitialStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="active">Active Execution</option>
                    <option value="paused">Paused / Standby</option>
                    <option value="stopped">Fully Terminated</option>
                  </select>
                </div>
              </div>

              {mode === 'backtest' && (
                <div className="grid grid-cols-2 gap-4 border border-indigo-950 bg-indigo-950/20 p-3 rounded-lg">
                  <div className="space-y-1">
                    <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Backtest Date (YYYY-MM-DD)</label>
                    <input
                      type="date"
                      required
                      value={backtestDate}
                      onChange={(e) => setBacktestDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Delay Speed (ms delay)</label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={backtestSpeed}
                      onChange={(e) => setBacktestSpeed(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 py-1">
                <input
                  id="chk-dynamic-symbol"
                  type="checkbox"
                  checked={dynamicSymbol}
                  onChange={(e) => setDynamicSymbol(e.target.checked)}
                  className="w-4 h-4 rounded-sm bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="chk-dynamic-symbol" className="text-[11px] text-slate-350 select-none cursor-pointer font-bold font-sans">
                  Dynamic option symbol (track underlying strike grid)
                </label>
              </div>

              {dynamicSymbol ? (
                <div className="space-y-3 border border-indigo-950 bg-indigo-950/20 p-3 rounded-lg">
                  <div className="space-y-1">
                    <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Underlying symbol</label>
                    <select
                      required
                      value={underlyingSymbolId}
                      onChange={(e) => setUnderlyingSymbolId(e.target.value)}
                      className="w-full bg-slate-955 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                    >
                      <option value="">Select active non-OPTION symbol...</option>
                      {underlyingCandidates.map((sym) => (
                        <option key={sym.id || sym.ticker} value={sym.id}>
                          {sym.name || sym.ticker} ({sym.ticker})
                          {sym.instrumentClass ? ` [${sym.instrumentClass}]` : ''}
                          {sym.strikePriceDiff != null ? ` (diff=${sym.strikePriceDiff})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Moneyness</label>
                      <select
                        value={moneyness}
                        onChange={(e) => setMoneyness(e.target.value as any)}
                        className="w-full bg-slate-955 border border-slate-800 rounded-md p-2 text-xs text-slate-200"
                      >
                        <option value="ITM">ITM</option>
                        <option value="ATM">ATM</option>
                        <option value="OTM">OTM</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Offset</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        disabled={moneyness === 'ATM'}
                        value={offset}
                        onChange={(e) => setOffset(parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-slate-955 border border-slate-800 rounded-md p-2 text-xs text-slate-100 font-mono disabled:opacity-50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Option Type</label>
                      <select
                        value={optionType}
                        onChange={(e) => setOptionType(e.target.value as any)}
                        className="w-full bg-slate-955 border border-slate-800 rounded-md p-2 text-xs text-slate-200"
                      >
                        <option value="CE">CE (Call)</option>
                        <option value="PE">PE (Put)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Expiry</label>
                      <input
                        type="date"
                        required
                        value={optionExpiry}
                        onChange={(e) => setOptionExpiry(e.target.value)}
                        className="w-full bg-slate-955 border border-slate-800 rounded-md p-2 text-xs text-slate-100 font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-505">
                    Option symbol is resolved from the chain (e.g. ITM-1 CE) and remapped when the underlying LTP crosses a strike grid level—only while the position is flat.
                  </p>
                </div>
              ) : (
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Target Symbol</label>
                <select
                  required
                  value={selectedSymbolId}
                  onChange={(e) => {
                    setSelectedSymbolId(e.target.value);
                    setNoOfLots(1);
                  }}
                  className="w-full bg-slate-955 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="">Select active symbol...</option>
                  {activeSymbols.map((sym) => (
                    <option key={sym.id || sym.ticker} value={sym.id}>
                      {sym.name || sym.ticker} ({sym.ticker})
                      {sym.instrumentClass ? ` [${sym.instrumentClass}]` : ''}
                      {sym.lotSize != null ? ` (lot=${sym.lotSize})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              )}

              {showLotSizing && (
                <div className="grid grid-cols-2 gap-3 border border-amber-950/40 bg-amber-950/10 p-3 rounded-lg">
                  <div className="space-y-1">
                    <label className="text-[10px] text-amber-400 uppercase font-mono tracking-wider font-bold">Lot Size</label>
                    <input
                      type="number"
                      readOnly={!dynamicSymbol}
                      min={1}
                      value={dynamicSymbol ? dynamicLotSize : (selectedLotSize || '')}
                      onChange={(e) => {
                        if (dynamicSymbol) setDynamicLotSize(parseInt(e.target.value, 10) || 0);
                      }}
                      className={`w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 font-mono ${
                        dynamicSymbol ? '' : 'opacity-80 cursor-not-allowed'
                      }`}
                    />
                    {!dynamicSymbol && (
                      <p className="text-[10px] text-slate-500">Prefilled from UserSymbol (read-only).</p>
                    )}
                  </div>
                  {!useFullAmount && (
                    <div className="space-y-1">
                      <label className="text-[10px] text-amber-400 uppercase font-mono tracking-wider font-bold">No. of Lots</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={noOfLots}
                        onChange={(e) => setNoOfLots(parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 font-mono"
                      />
                      <p className="text-[10px] text-slate-500">
                        Order qty = {(dynamicSymbol ? dynamicLotSize : selectedLotSize) || 0} × {noOfLots}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Checkbox for Use Full Amount — below symbol / lot sizing */}
              <div className="flex items-center gap-2 py-1">
                <input
                  id="chk-use-full-amount"
                  type="checkbox"
                  checked={useFullAmount}
                  onChange={(e) => setUseFullAmount(e.target.checked)}
                  className="w-4 h-4 rounded-sm bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="chk-use-full-amount" className="text-[11px] text-slate-350 select-none cursor-pointer font-bold font-sans">
                  Use Full Account Balance for Allocation
                </label>
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
                  Deploy Container Bot
                </button>
              </div>

            </form>

          </div>
        </div>
      )}
      {/* Edit Deployment Modal */}
      {editingStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Edit className="w-4 h-4 text-indigo-400" />
                Edit Deployment
              </h3>
              <button 
                onClick={() => setEditingStrategy(null)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Deployment Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
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

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Candle Timeframe</label>
                <select
                  value={editTimeframe}
                  onChange={(e) => setEditTimeframe(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500 font-mono"
                >
                  <option value="1m">1 minute (1m)</option>
                  <option value="3m">3 minute (3m)</option>
                  <option value="5m">5 minute (5m)</option>
                  <option value="15m">15 minute (15m)</option>
                </select>
              </div>

              {editingStrategy.mode === 'backtest' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Backtest Date</label>
                    <input
                      type="date"
                      required
                      value={editBacktestDate}
                      onChange={(e) => setEditBacktestDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-105 focus:outline-hidden focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Ticks Pace (ms)</label>
                    <input
                      type="number"
                      required
                      min="50"
                      max="10000"
                      value={editBacktestSpeed}
                      onChange={(e) => setEditBacktestSpeed(parseInt(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-105 focus:outline-hidden focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="edit-use-full-amount"
                  checked={editUseFullAmount}
                  onChange={(e) => setEditUseFullAmount(e.target.checked)}
                  className="w-3.5 h-3.5 bg-slate-955 border-slate-800 rounded focus:ring-0 text-indigo-600 focus:ring-offset-0"
                />
                <label htmlFor="edit-use-full-amount" className="text-xs text-slate-300 select-none">
                  Allocate Full Account Buying Power
                </label>
              </div>

              {editingStrategy.lotSize != null && Number(editingStrategy.lotSize) > 0 && (
                <div className="grid grid-cols-2 gap-3 border border-amber-950/40 bg-amber-950/10 p-3 rounded-lg">
                  <div className="space-y-1">
                    <label className="text-[10px] text-amber-400 uppercase font-mono tracking-wider font-bold">Lot Size</label>
                    <input
                      type="number"
                      readOnly
                      value={editingStrategy.lotSize}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 font-mono opacity-80 cursor-not-allowed"
                    />
                  </div>
                  {!editUseFullAmount && (
                    <div className="space-y-1">
                      <label className="text-[10px] text-amber-400 uppercase font-mono tracking-wider font-bold">No. of Lots</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={editNoOfLots}
                        onChange={(e) => setEditNoOfLots(parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingStrategy(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Update Deployment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Deployment Confirmation warning */}
      {deletingStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-rose-955 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6 bg-rose-950/20 border-b border-rose-900/30 flex items-center gap-3">
              <div className="p-2 bg-rose-900/30 rounded-lg text-rose-455">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-200 uppercase tracking-wider font-mono">
                  Delete Deployment Bot
                </h3>
                <p className="text-[10px] text-rose-400 font-medium">Critical Action Required</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
                <p>
                  You are about to permanently delete deployment bot workload <strong className="text-white font-semibold font-mono">{deletingStrategy.name}</strong> ({deletingStrategy.id}).
                </p>
                <div className="p-3.5 bg-rose-950/30 border border-rose-900/30 rounded-lg text-rose-350 space-y-2">
                  <p className="font-bold text-[10px] uppercase font-mono tracking-wider flex items-center gap-1 text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5" /> Permanent Cascading Impact
                  </p>
                  <p className="text-[11px] text-rose-300">
                    Deleting this deployment bot will permanently delete:
                  </p>
                  <ul className="list-disc pl-5 text-[11px] text-rose-300 space-y-1 font-medium">
                    <li>This deployment bot container settings</li>
                    <li>All historical trades/transactions executed by this bot instance</li>
                    <li>All positions, ledgers, and Redis stats tracking this workload</li>
                  </ul>
                </div>
                <p className="text-[11px] text-slate-400">
                  Please type the deployment name <span className="font-mono text-white select-all bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">{deletingStrategy.name}</span> below to confirm.
                </p>
              </div>

              <input
                type="text"
                placeholder="Type deployment name to confirm"
                value={deleteConfirmInput}
                className="w-full bg-slate-950 border border-rose-900/30 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-rose-500 font-mono"
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
              />

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setDeletingStrategy(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete-dep"
                  disabled={deleteConfirmInput !== deletingStrategy.name}
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
