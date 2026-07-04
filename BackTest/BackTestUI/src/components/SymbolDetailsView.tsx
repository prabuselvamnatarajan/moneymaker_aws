/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  LineChart, TrendingUp, TrendingDown, Clock, Activity, ArrowLeft, 
  Layers, ExternalLink, RefreshCw, BarChart3, HelpCircle, ArrowUpRight 
} from 'lucide-react';
import { SymbolData, Transaction, Strategy } from '../types';
import TransactionList from './TransactionList';

interface SymbolDetailsViewProps {
  symbol: SymbolData;
  transactions: Transaction[];
  strategies: Strategy[];
  onBackToDashboard: () => void;
  onNavigateToEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  onSelectTransaction: (tx: Transaction) => void;
  onDrilldownToTransactions: (filterKey: 'symbol', filterValue: string) => void;
  timezone: string;
  onNavigateToScreen?: (screen: any) => void;
}

export default function SymbolDetailsView({
  symbol,
  transactions,
  strategies,
  onBackToDashboard,
  onNavigateToEntity,
  onSelectTransaction,
  onDrilldownToTransactions,
  timezone,
  onNavigateToScreen,
}: SymbolDetailsViewProps) {

  // Filter transactions belonging to this symbol
  const filteredTxs = transactions.filter((tx) => tx.symbol === symbol.ticker);

  // Find strategies associated with this symbol
  const activeStrategies = strategies.filter((strat) => strat.symbols.includes(symbol.ticker));

  const isPositive = symbol.change24h >= 0;

  return (
    <div className="space-y-6">
      
      {/* Back button and breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium select-none">
        <button
          onClick={onBackToDashboard}
          className="flex items-center gap-1 hover:text-indigo-400 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
        <span>/</span>
        <button
          onClick={() => onNavigateToScreen?.('symbols-list')}
          className="text-slate-400 font-mono hover:text-indigo-400 transition-colors cursor-pointer"
        >
          Symbols
        </button>
        <span>/</span>
        <button
          onClick={() => onNavigateToScreen?.('symbols-list')}
          className="text-slate-200 font-bold font-mono hover:text-indigo-400 transition-colors cursor-pointer"
        >
          {symbol.ticker}
        </button>
      </div>

      {/* Main Header Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-900 rounded-lg text-indigo-400 border border-slate-800">
            <LineChart className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white font-mono tracking-tight">{symbol.ticker}</h2>
              <span className="text-[10px] uppercase font-mono tracking-wider font-semibold bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                {symbol.instrumentType}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{symbol.name} • Traded via {symbol.exchange}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-md border border-slate-800">
            <Clock className="w-3.5 h-3.5 text-indigo-400" /> FEED: DELAYLESS 200ms
          </span>
        </div>
      </div>

      {/* Snapshot Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-sans">
        
        {/* Market Rate */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Current Execution Quote</p>
          <p className="text-xl font-black font-mono text-slate-100 mt-1.5">
            ₹{symbol.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
          </p>
          <span className="text-[10px] text-slate-500 mt-1 block">Live pricing from centralized engine book</span>
        </div>

        {/* 24h Swing */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">24-Hour Market Swing</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-xl font-black font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isPositive ? '+' : ''}{symbol.change24h}%
            </span>
            <span className={`p-0.5 rounded-sm text-[10px] font-mono font-bold ${isPositive ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
              {isPositive ? 'BULLISH' : 'BEARISH'}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1 block">Volatility delta check</span>
        </div>

        {/* 24h Volume */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Estimated Liquidity Volume (24h)</p>
          <p className="text-xl font-bold font-mono text-slate-100 mt-1.5">
            ₹{symbol.volume24h.toLocaleString()}
          </p>
          <span className="text-[10px] text-slate-500 mt-1 block">Aggregated market-wide activity</span>
        </div>
      </div>

      {/* Active Algorithmic Strategies mapping */}
      <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4 font-sans">
        <div>
          <h3 className="text-sm font-bold text-slate-200">Active Strategies Deployed on {symbol.ticker}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Strategies configured to analyze and execute contract orders on this asset.</p>
        </div>

        {activeStrategies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeStrategies.map((strat) => {
              return (
                <div 
                  key={strat.id}
                  className="p-4 bg-slate-900 rounded-lg border border-slate-800 flex flex-col justify-between group hover:border-slate-700 transition-all"
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <h4 className="text-xs font-bold text-slate-200">{strat.name}</h4>
                      <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                        strat.mode === 'live' 
                          ? 'bg-rose-950/50 text-rose-400 border border-rose-900/40' 
                          : 'bg-indigo-950/50 text-indigo-400 border border-indigo-900/40'
                      }`}>
                        {strat.mode.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2 truncate max-w-xs">{strat.description}</p>
                    
                    <div className="flex gap-2.5 font-mono text-[9px] text-slate-500 mt-3.5">
                      <span>Trades: <strong className="text-slate-400 font-bold">{strat.totalTrades}</strong></span>
                      <span>•</span>
                      <span>Win Rate: <strong className="text-slate-400 font-bold">{strat.winRate}%</strong></span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                    <span className={`text-[10px] font-mono font-bold ${strat.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      P&L: {strat.pnl >= 0 ? '+' : ''}₹{strat.pnl.toLocaleString()}
                    </span>
                    <button
                      id={`sym-strat-link-${strat.id}`}
                      onClick={() => onNavigateToEntity('strategy', strat.id)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline text-left group-hover:translate-x-0.5 transition-transform"
                    >
                      Inspect Strategy <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 bg-slate-900/10 border border-slate-800/40 rounded-lg">
            <p className="text-xs font-semibold">No active automated strategies currently targeted on this asset</p>
            <p className="text-[11px] text-slate-600 mt-1">Configure asset targets in Strategy Deployments console to initiate auto-executions.</p>
          </div>
        )}
      </div>

      {/* Transactions list section */}
      <div className="pt-4 border-t border-slate-800 font-sans">
        <TransactionList
          transactions={filteredTxs}
          accounts={[]}
          strategies={strategies}
          variant="compact"
          timezone={timezone}
          onRowClick={onSelectTransaction}
          onViewAllDrilldown={() => onDrilldownToTransactions('symbol', symbol.ticker)}
        />
      </div>

    </div>
  );
}
