/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { 
  Play, Pause, Square, TrendingUp, TrendingDown, Target, Zap, 
  Layers, ChevronLeft, Calendar, HelpCircle, ArrowUpRight, ArrowLeft, RefreshCw,
  Edit, Trash2, AlertTriangle, X
} from 'lucide-react';
import { Strategy, Transaction, SymbolData } from '../types';
import TransactionList from './TransactionList';
import { api } from '../api';
import { mapTrade } from '../adapters';

interface StrategyDetailsViewProps {
  strategy: Strategy;
  symbols: SymbolData[];
  onBackToDashboard: () => void;
  onUpdateStrategyStatus: (stratId: string, status: 'active' | 'paused' | 'stopped') => void;
  onNavigateToEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  onSelectTransaction: (tx: Transaction) => void;
  onDrilldownToTransactions: (filterKey: 'strategyId', filterValue: string) => void;
  timezone: string;
  onNavigateToScreen?: (screen: any) => void;
  onRefreshData?: () => Promise<void> | void;
  onEditStrategy?: (id: string, updateData: any) => Promise<void> | void;
  onDeleteStrategy?: (id: string) => Promise<void> | void;
}

export default function StrategyDetailsView({
  strategy,
  symbols,
  onBackToDashboard,
  onUpdateStrategyStatus,
  onNavigateToEntity,
  onSelectTransaction,
  onDrilldownToTransactions,
  timezone,
  onNavigateToScreen,
  onRefreshData,
  onEditStrategy,
  onDeleteStrategy,
}: StrategyDetailsViewProps) {

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

  const handleOpenEdit = (strat: Strategy) => {
    setEditingStrategy(strat);
    setEditName(strat.name);
    setEditDescription(strat.description || '');
    setEditBacktestDate(strat.backtestDate || '');
    setEditBacktestSpeed(strat.backtestSpeed || 1000);
    setEditUseFullAmount(strat.useFullAmount || false);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStrategy || !onEditStrategy) return;
    try {
      await onEditStrategy(editingStrategy.id, {
        deployment_name: editName,
        notes: editDescription,
        backtest_date: editingStrategy.mode === 'backtest' ? editBacktestDate : undefined,
        backtest_speed: editingStrategy.mode === 'backtest' ? editBacktestSpeed : undefined,
        use_full_amount: editUseFullAmount,
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
      onBackToDashboard(); // go back on delete
    } catch (err) {
      console.error(err);
    }
  };

  // --- Self-fetched transactions for this strategy/deployment ---
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    if (!strategy?.id) return;
    setTxLoading(true);
    setTxError(null);
    try {
      // Fetch trades server-side filtered by deployment_id (strategy.id maps to deployment)
      const tradesRes = await api.trades.listForDeployment(strategy.id);
      const mapped = tradesRes.items.map(mapTrade);
      setTransactions(mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    } catch (err: any) {
      setTxError(err.message || 'Failed to load transactions');
    } finally {
      setTxLoading(false);
    }
  };

  const handleRefresh = async () => {
    await fetchTransactions();
    if (onRefreshData) {
      await onRefreshData();
    }
  };

  useEffect(() => {
    fetchTransactions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy?.id]);

  // Find associated symbol detail states
  const matchedSymbols = symbols.filter((sym) => 
    strategy.symbols.map(s => s.toUpperCase()).includes(sym.ticker.toUpperCase())
  );

  const isPositive = strategy.pnl >= 0;

  // Reconstruct active positions from fetched transaction history for this strategy
  const calculatedPositions = React.useMemo(() => {
    const tradeTxs = transactions.filter((tx) => tx.transactionType === 'TRADE');
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
  }, [transactions]);

  const positions = calculatedPositions;

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
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium select-none">
        <button
          onClick={onBackToDashboard}
          className="flex items-center gap-1 hover:text-indigo-400 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
        <span>/</span>
        <button
          onClick={() => onNavigateToScreen?.('strategies-list')}
          className="text-slate-400 font-mono hover:text-indigo-400 transition-colors cursor-pointer"
        >
          Strategies
        </button>
        <span>/</span>
        <button
          onClick={() => onNavigateToScreen?.('strategies-list')}
          className="text-slate-200 font-bold hover:text-indigo-400 transition-colors cursor-pointer"
        >
          {strategy.name}
        </button>
      </div>

      {/* Main header block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
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
        <div className="flex flex-wrap items-center gap-2 bg-slate-900 p-1.5 rounded-lg border border-slate-850">
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

          {onEditStrategy && (
            <button
              onClick={() => handleOpenEdit(strategy)}
              className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 border border-slate-800 rounded-md transition-colors cursor-pointer"
              title="Edit Deployment"
            >
              <Edit className="w-4 h-4" />
            </button>
          )}

          {onDeleteStrategy && (
            <button
              onClick={() => setDeletingStrategy(strategy)}
              className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-slate-800 border border-slate-800 rounded-md transition-colors cursor-pointer"
              title="Delete Deployment"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Numerical Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 font-sans">
        
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
            {strategy.totalTrades === 0 ? (
              <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded font-bold font-mono">
                No Trades Yet
              </span>
            ) : strategy.winRate >= 60 ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded font-bold font-mono">
                High Win Edge
              </span>
            ) : strategy.winRate >= 40 ? (
              <span className="text-[10px] text-amber-400 bg-amber-950 px-1.5 py-0.5 rounded font-bold font-mono">
                Moderate Edge
              </span>
            ) : (
              <span className="text-[10px] text-rose-400 bg-rose-950 px-1.5 py-0.5 rounded font-bold font-mono">
                Low Win Edge
              </span>
            )}
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
        
        {/* Associated Symbols Grid */}
        <div className="bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Associated Traded Assets</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Asset tickers explicitly targeted by this algorithm.</p>
          </div>

          <div className="space-y-2.5">
            {matchedSymbols.length > 0 ? matchedSymbols.map((sym) => {
              const isGain = sym.change24h >= 0;
              return (
                <div 
                  key={sym.ticker}
                  className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
                >
                  <div className="font-mono min-w-0 flex-1">
                    <span className="text-xs font-bold text-slate-100 truncate block">{sym.ticker}</span>
                    <span className="text-[10px] text-slate-400 block font-sans truncate">{sym.name}</span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
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
            }) : (
              <div className="p-6 text-center text-slate-500 bg-slate-900/10 border border-slate-800/40 rounded-lg text-xs">
                No symbols linked to this strategy.
              </div>
            )}
          </div>
        </div>

        {/* Strategy Portfolio Positions */}
        <div className="lg:col-span-2 bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Strategy Portfolio Positions</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Security holdings and exposures managed dynamically by this algorithm.</p>
          </div>

          {positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans divide-y divide-slate-850 border border-slate-800 rounded-lg overflow-hidden min-w-[520px]">
                <thead className="bg-slate-900/50 text-slate-500 uppercase font-semibold font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Asset</th>
                    <th className="p-3 text-right">Size</th>
                    <th className="p-3 text-right">Avg Cost</th>
                    <th className="p-3 text-right">Cur. Price</th>
                    <th className="p-3 text-right">Mkt Value</th>
                    <th className="p-3 text-right">Unrealized P&L</th>
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

      {/* Transactions Section — dynamically fetched */}
      <div className="pt-4 border-t border-slate-800 font-sans">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Strategy Trade History</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Live-fetched from server for this deployment — no client-side filtering.
              {!txLoading && <span className="text-indigo-400 ml-1">{transactions.length} trades</span>}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={txLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${txLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {txError && (
          <div className="p-3 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-lg text-xs mb-3">
            Error loading transactions: {txError}
          </div>
        )}

        {txLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-900/60 rounded-lg animate-pulse border border-slate-800" />
            ))}
          </div>
        ) : (
          <TransactionList
            transactions={transactions}
            accounts={[]}
            strategies={[strategy]}
            variant="compact"
            timezone={timezone}
            onRowClick={onSelectTransaction}
            onViewAllDrilldown={() => onDrilldownToTransactions('strategyId', strategy.id)}
          />
        )}
      </div>

      {/* Edit Deployment Modal */}
      {editingStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-955/80 backdrop-blur-xs font-sans">
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
                  id="edit-use-full-amount-details"
                  checked={editUseFullAmount}
                  onChange={(e) => setEditUseFullAmount(e.target.checked)}
                  className="w-3.5 h-3.5 bg-slate-955 border-slate-800 rounded focus:ring-0 text-indigo-600 focus:ring-offset-0"
                />
                <label htmlFor="edit-use-full-amount-details" className="text-xs text-slate-300 select-none">
                  Allocate Full Account Buying Power
                </label>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingStrategy(null)}
                  className="px-4 py-2 bg-slate-955 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
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
                  id="btn-confirm-delete-dep-details"
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
