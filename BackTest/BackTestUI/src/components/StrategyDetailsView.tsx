/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Play, Pause, Square, TrendingUp, TrendingDown, Target, Zap, 
  Layers, ChevronLeft, Calendar, HelpCircle, ArrowUpRight, ArrowLeft 
} from 'lucide-react';
import { Strategy, Transaction, SymbolData } from '../types';
import TransactionList from './TransactionList';

interface StrategyDetailsViewProps {
  strategy: Strategy;
  symbols: SymbolData[];
  transactions: Transaction[];
  onBackToDashboard: () => void;
  onUpdateStrategyStatus: (stratId: string, status: 'active' | 'paused' | 'stopped') => void;
  onNavigateToEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  onSelectTransaction: (tx: Transaction) => void;
  onDrilldownToTransactions: (filterKey: 'strategyId', filterValue: string) => void;
  timezone: string;
}

export default function StrategyDetailsView({
  strategy,
  symbols,
  transactions,
  onBackToDashboard,
  onUpdateStrategyStatus,
  onNavigateToEntity,
  onSelectTransaction,
  onDrilldownToTransactions,
  timezone,
}: StrategyDetailsViewProps) {
  
  // Filter transactions connected to this strategy
  const filteredTxs = transactions.filter((tx) => tx.strategyId === strategy.id);

  // Find associated symbol detail states
  const matchedSymbols = symbols.filter((sym) => strategy.symbols.includes(sym.ticker));

  const isPositive = strategy.pnl >= 0;

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        timeZone: timezone === 'UTC' ? 'UTC' : undefined,
        hour12: false,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Back button and breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
        <button
          onClick={onBackToDashboard}
          className="flex items-center gap-1 hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
        <span>/</span>
        <span className="text-slate-400 font-mono">Strategies</span>
        <span>/</span>
        <span className="text-slate-200 font-bold">{strategy.name}</span>
      </div>

      {/* Main header block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-white font-sans tracking-tight">{strategy.name}</h2>
            <span className={`px-2 py-0.5 rounded-sm text-[10px] font-mono font-bold tracking-wider ${
              strategy.status === 'active' ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' :
              strategy.status === 'paused' ? 'bg-amber-950 text-amber-400 border border-amber-900' :
              'bg-slate-950 text-slate-400 border border-slate-900'
            }`}>
              {strategy.status.toUpperCase()}
            </span>
            <span className={`px-2 py-0.5 rounded-sm text-[10px] font-mono font-bold tracking-wider ${
              strategy.mode === 'live' 
                ? 'bg-rose-950/80 text-rose-400 border border-rose-900' 
                : 'bg-indigo-950/80 text-indigo-400 border border-indigo-900'
            }`}>
              {strategy.mode.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-xl font-sans leading-relaxed">{strategy.description}</p>
        </div>

        {/* Operational state controllers */}
        <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-lg border border-slate-850">
          <button
            id="strategy-ctrl-start"
            onClick={() => onUpdateStrategyStatus(strategy.id, 'active')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              strategy.status === 'active'
                ? 'bg-emerald-600 text-white font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Play className="w-3.5 h-3.5" /> Start
          </button>
          
          <button
            id="strategy-ctrl-pause"
            onClick={() => onUpdateStrategyStatus(strategy.id, 'paused')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              strategy.status === 'paused'
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Pause className="w-3.5 h-3.5" /> Pause
          </button>

          <button
            id="strategy-ctrl-stop"
            onClick={() => onUpdateStrategyStatus(strategy.id, 'stopped')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              strategy.status === 'stopped'
                ? 'bg-red-600 text-white font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Square className="w-3.5 h-3.5 fill-current" /> Stop
          </button>
        </div>
      </div>

      {/* Numerical Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-sans">
        
        {/* Cumulative P&L Card */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Total Cumulative Return</p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className={`text-xl font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isPositive ? '+' : ''}${strategy.pnl.toLocaleString()}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-1 font-sans">
            {isPositive ? 'Outperforming baseline indexes' : 'Underperforming drawdown threshold'}
          </span>
        </div>

        {/* Exposed Positions */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold font-sans">Open Exposed Positions</p>
          <p className="text-xl font-bold font-mono text-slate-100 mt-1.5">
            {strategy.openPositions}
          </p>
          <span className="text-[10px] text-slate-500 mt-1 block">Active risk allocations</span>
        </div>

        {/* Win-Rate */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Strategy Win Rate</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xl font-bold font-mono text-slate-100">
              {strategy.winRate}%
            </span>
            <span className="text-[10px] text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded font-bold font-mono">
              High Win Edge
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1 block font-sans">Out of {strategy.totalTrades} historical trades</span>
        </div>

        {/* Deployments Clock */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Last Server deployment</p>
          <p className="text-xs font-semibold text-slate-200 font-mono mt-2 truncate">
            {formatDate(strategy.lastDeployTime)}
          </p>
          <span className="text-[10px] text-slate-500 mt-1 flex items-center gap-1 font-sans">
            <Calendar className="w-3 h-3 text-slate-500" /> Active container uptime
          </span>
        </div>
      </div>

      {/* Relational Ticker Links and Cloud deployments metadata */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
        
        {/* Associated Symbols Grid */}
        <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Associated Traded Assets</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Asset tickers explicitly targeted by this algorithm.</p>
          </div>

          <div className="space-y-2.5">
            {matchedSymbols.map((sym) => {
              const isGain = sym.change24h >= 0;
              return (
                <div 
                  key={sym.ticker}
                  className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
                >
                  <div className="font-mono">
                    <span className="text-xs font-bold text-slate-100">{sym.ticker}</span>
                    <span className="text-[10px] text-slate-400 block font-sans truncate max-w-[120px]">{sym.name}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right font-mono text-xs">
                      <span className="text-slate-200 font-semibold">${sym.lastPrice.toLocaleString()}</span>
                      <span className={`text-[10px] block ${isGain ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {isGain ? '+' : ''}{sym.change24h}%
                      </span>
                    </div>
                    <button
                      id={`strat-sym-link-${sym.ticker.replace('/', '-')}`}
                      onClick={() => onNavigateToEntity('symbol', sym.ticker)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300"
                      title="Drill down to Symbol Details"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Server Deployments Telemetry (Visual representation) */}
        <div className="md:col-span-2 bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Container Deployment Clusters</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Active cloud engines running container workloads of this algorithm.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg flex items-start gap-3">
              <span className={`w-2.5 h-2.5 rounded-full mt-1 ${strategy.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
              <div>
                <h4 className="text-xs font-bold text-slate-200 font-mono">AWS-US-EAST-2 (PROD-01)</h4>
                <p className="text-[10px] text-slate-500 font-sans mt-0.5">Primary execution node. Region latency: 12ms.</p>
                <div className="mt-3 flex gap-2 font-mono text-[9px]">
                  <span className="bg-slate-950 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">CPU: 4.2%</span>
                  <span className="bg-slate-950 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">MEM: 124MB</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg flex items-start gap-3">
              <span className={`w-2.5 h-2.5 rounded-full mt-1 ${strategy.status === 'active' ? 'bg-indigo-500 animate-pulse' : 'bg-slate-600'}`} />
              <div>
                <h4 className="text-xs font-bold text-slate-200 font-mono">GCP-EUROPE-WEST-1 (STANDBY)</h4>
                <p className="text-[10px] text-slate-500 font-sans mt-0.5">High availability standby. Hot-swap synchronized.</p>
                <div className="mt-3 flex gap-2 font-mono text-[9px]">
                  <span className="bg-slate-950 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">CPU: 1.1%</span>
                  <span className="bg-slate-950 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">MEM: 82MB</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Transactions Section */}
      <div className="pt-4 border-t border-slate-800 font-sans">
        <TransactionList
          transactions={filteredTxs}
          accounts={[]}
          strategies={[strategy]}
          variant="compact"
          timezone={timezone}
          onRowClick={onSelectTransaction}
          onViewAllDrilldown={() => onDrilldownToTransactions('strategyId', strategy.id)}
        />
      </div>

    </div>
  );
}
