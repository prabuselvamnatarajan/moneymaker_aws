/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Cpu, Search, Plus, Play, Pause, Square, Activity, TrendingUp, 
  BarChart2, DollarSign, Globe, X, ChevronRight, AlertTriangle 
} from 'lucide-react';
import { Strategy, SymbolData, Account } from '../types';

interface StrategiesListViewProps {
  strategies: Strategy[];
  symbols: SymbolData[];
  accounts: Account[];
  onAddStrategy: (newStrat: Strategy, accountId: string, symbol: string) => void;
  onUpdateStrategyStatus: (id: string, status: 'active' | 'paused' | 'stopped') => void;
  onNavigateToEntity: (type: 'strategy', id: string) => void;
}

export default function StrategiesListView({
  strategies,
  symbols,
  accounts,
  onAddStrategy,
  onUpdateStrategyStatus,
  onNavigateToEntity
}: StrategiesListViewProps) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'live' | 'backtest'>('live');
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [initialStatus, setInitialStatus] = useState<'active' | 'paused' | 'stopped'>('active');
  const [selectedAccountId, setSelectedAccountId] = useState('');

  // Computed metrics
  const totalPnl = strategies.reduce((sum, s) => sum + s.pnl, 0);
  const activeCount = strategies.filter(s => s.status === 'active').length;
  const avgWinRate = strategies.reduce((sum, s) => sum + s.winRate, 0) / (strategies.length || 1);
  const totalOpenPositions = strategies.reduce((sum, s) => sum + s.openPositions, 0);

  const filteredStrategies = strategies.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase()) ||
    s.symbols.some(sym => sym.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSymbolToggle = (ticker: string) => {
    setSelectedSymbols(prev => 
      prev.includes(ticker) 
        ? prev.filter(t => t !== ticker) 
        : [...prev, ticker]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !description || !selectedAccountId) return;

    const newStrat: Strategy = {
      id: `STRAT-0${strategies.length + 1}`,
      name,
      mode,
      status: initialStatus,
      pnl: 0,
      totalTrades: 0,
      winRate: 50.0, // starts flat
      lastDeployTime: new Date().toISOString(),
      openPositions: 0,
      symbols: selectedSymbols.length > 0 ? selectedSymbols : ['BTC/USD'],
      description
    };

    const targetSymbol = selectedSymbols.length > 0 ? selectedSymbols[0] : 'BTC/USD';
    onAddStrategy(newStrat, selectedAccountId, targetSymbol);
    
    // Reset Form
    setName('');
    setDescription('');
    setMode('live');
    setSelectedSymbols([]);
    setInitialStatus('active');
    setSelectedAccountId('');
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
        
        <button
          id="btn-deploy-strategy-trigger"
          onClick={() => setShowAddForm(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 shrink-0 self-start sm:self-center"
        >
          <Plus className="w-4 h-4" /> Deploy New Strategy
        </button>
      </div>

      {/* Aggregate metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-sans">
        
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Total Cumulative Yield</p>
          <p className={`text-xl font-black font-mono mt-1.5 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 0 })}
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 font-sans">
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
                      {strat.symbols.map(sym => (
                        <span key={sym} className="text-[10px] font-mono text-indigo-300 bg-indigo-500/5 border border-indigo-500/10 px-2 py-0.5 rounded-sm">
                          {sym}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 border-t border-slate-900/85 pt-4 mt-5">
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Workload Return</p>
                    <p className={`text-sm font-bold font-mono ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPnlPositive ? '+' : ''}${strat.pnl.toLocaleString(undefined, { minimumFractionDigits: 0 })}
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

                  <div className="flex items-center justify-end">
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
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Cpu className="w-4 h-4 text-indigo-400" />
                Deploy New Bot / Strategy
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
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Strategy Workload Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Bollinger Bands MACD Scalp v1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Model Objective Description</label>
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
                      {acc.name} (${acc.balance.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Deployment Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="live">Live Workload (Real-Time API)</option>
                    <option value="backtest">Backtest Engine (Historical Audit)</option>
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

              {/* Target Symbol Multi select list */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Targeted Market Symbols</label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950 rounded border border-slate-800 max-h-24 overflow-y-auto">
                  {symbols.map(sym => {
                    const isChecked = selectedSymbols.includes(sym.ticker);
                    return (
                      <button
                        type="button"
                        key={sym.ticker}
                        onClick={() => handleSymbolToggle(sym.ticker)}
                        className={`px-2 py-1 rounded text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                          isChecked 
                            ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30' 
                            : 'bg-slate-900 text-slate-500 border-slate-850 hover:text-slate-300'
                        }`}
                      >
                        {sym.ticker}
                      </button>
                    );
                  })}
                </div>
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

    </div>
  );
}
