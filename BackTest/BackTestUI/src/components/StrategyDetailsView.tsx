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

  // Reconstruct active positions from transaction history for this specific strategy
  const calculatedPositions = React.useMemo(() => {
    const tradeTxs = filteredTxs.filter((tx) => tx.transactionType === 'TRADE');
    const assetGroups: Record<string, { size: number; totalCost: number }> = {};

    const sortedTrades = [...tradeTxs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    sortedTrades.forEach((tx) => {
      const symbol = tx.symbol || 'UNKNOWN';
      const qty = tx.quantity || 0;
      const price = tx.price || 0;
      const isBuy = tx.type === 'BUY';

      if (!assetGroups[symbol]) {
        assetGroups[symbol] = { size: 0, totalCost: 0 };
      }

      const group = assetGroups[symbol];

      if (isBuy) {
        const newSize = group.size + qty;
        if (newSize > 0) {
          group.totalCost = (group.totalCost * group.size + price * qty) / newSize;
        } else {
          group.totalCost = 0;
        }
        group.size = newSize;
      } else {
        const newSize = group.size - qty;
        if (newSize <= 0) {
          group.totalCost = 0;
          group.size = 0;
        } else {
          group.size = newSize;
        }
      }
    });

    return Object.keys(assetGroups)
      .map((ticker) => {
        const group = assetGroups[ticker];
        const currentPrice = 100.0; // Fallback price
        const marketValue = group.size * currentPrice;
        const totalCost = group.size * group.totalCost;
        const pnl = parseFloat((marketValue - totalCost).toFixed(2));

        return {
          ticker,
          size: group.size,
          avgEntry: parseFloat(group.totalCost.toFixed(2)),
          currentPrice,
          marketValue: parseFloat(marketValue.toFixed(2)),
          pnl,
        };
      })
      .filter((pos) => pos.size > 0);
  }, [filteredTxs]);

  const getMockPositions = () => {
    if (strategy.id.includes('MeanReversion') || strategy.name.toLowerCase().includes('mean reversion')) {
      return [
        { ticker: 'NSE_INDEX|Nifty 50', size: 50, avgEntry: 24300.00, currentPrice: 24350.00, marketValue: 1217500, pnl: 2500 },
      ];
    } else if (strategy.id.includes('Momentum') || strategy.name.toLowerCase().includes('momentum')) {
      return [
        { ticker: 'NSE_INDEX|Nifty Bank', size: 25, avgEntry: 52000.00, currentPrice: 52100.00, marketValue: 1302500, pnl: 2500 },
      ];
    }
    return [];
  };

  const positions = calculatedPositions.length > 0 ? calculatedPositions : getMockPositions();

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
                : strategy.mode === 'paper'
                ? 'bg-cyan-950/80 text-cyan-400 border border-cyan-900'
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
              {isPositive ? '+' : ''}₹{strategy.pnl.toLocaleString()}
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
                      <span className="text-slate-200 font-semibold">₹{sym.lastPrice.toLocaleString()}</span>
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

        {/* Strategy Portfolio Positions */}
        <div className="md:col-span-2 bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Strategy Portfolio Positions</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Security holdings and exposures managed dynamically by this algorithm.</p>
          </div>

          {positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans divide-y divide-slate-850 border border-slate-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-900/50 text-slate-500 uppercase font-semibold font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Asset</th>
                    <th className="p-3 text-right">Size</th>
                    <th className="p-3 text-right">Avg Cost</th>
                    <th className="p-3 text-right">Current Price</th>
                    <th className="p-3 text-right">Market Value</th>
                    <th className="p-3 text-right">Unrealized profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {positions.map((pos) => {
                    const posGain = pos.pnl >= 0;
                    return (
                      <tr key={pos.ticker} className="hover:bg-indigo-600/5 transition-colors">
                        <td className="p-3 font-bold font-mono text-slate-200">{pos.ticker}</td>
                        <td className="p-3 text-right text-slate-300 font-mono">{pos.size}</td>
                        <td className="p-3 text-right text-slate-400 font-mono">₹{pos.avgEntry.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right text-slate-200 font-mono">₹{pos.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right text-slate-300 font-mono font-semibold">₹{pos.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className={`p-3 text-right font-mono font-bold ${posGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {posGain ? '+' : ''}₹{pos.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 bg-slate-900/10 border border-slate-800/40 rounded-lg">
              <p className="text-xs font-semibold">No active exposed positions currently loaded</p>
              <p className="text-[11px] text-slate-605 mt-1">
                This strategy does not have any active inventory positions allocated.
              </p>
            </div>
          )}
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
