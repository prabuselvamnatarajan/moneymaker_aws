/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useToast } from './Toast';
import { 
  IndianRupee as IndianRupeeIcon, Activity as ActivityIcon, Percent as PercentIcon, 
  ArrowUpRight as ArrowUpRightIcon, ArrowDownRight as ArrowDownRightIcon, 
  Play as PlayIcon, Pause as PauseIcon, Plus as PlusIcon, 
  ShieldCheck as ShieldCheckIcon, RefreshCw as RefreshCwIcon, 
  Send as SendIcon, Radio as RadioIcon, Zap as ZapIcon, Info, Sliders, Server
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Account, Strategy, SymbolData, Transaction } from '../types';
import { api } from '../api';
import { mapLedger } from '../adapters';

interface DashboardViewProps {
  accounts: Account[];
  strategies: Strategy[];
  symbols: SymbolData[];
  transactions: Transaction[];
  onAddTransaction: (newTx: Transaction) => Promise<void> | void;
  onToggleBrokerStatus: (accountId: string) => void;
  onNavigateToEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  onSelectTransaction: (tx: Transaction) => void;
}

// Generate some nice chronological portfolio performance chart data
const PERFORMANCE_HISTORY = [
  { time: '09:30', MeanReversion: 12000, Momentum: 8000, GridBot: -500 },
  { time: '10:30', MeanReversion: 14500, Momentum: 9200, GridBot: -1200 },
  { time: '11:30', MeanReversion: 13800, Momentum: 11000, GridBot: -800 },
  { time: '12:30', MeanReversion: 18400, Momentum: 10500, GridBot: -1500 },
  { time: '13:30', MeanReversion: 21200, Momentum: 13100, GridBot: -2000 },
  { time: '14:30', MeanReversion: 24500, Momentum: 12400, GridBot: -2400 },
  { time: '15:30', MeanReversion: 28450, Momentum: 14200, GridBot: -2350 },
];

export default function DashboardView({
  accounts,
  strategies,
  symbols,
  transactions,
  onAddTransaction,
  onToggleBrokerStatus,
  onNavigateToEntity,
  onSelectTransaction,
}: DashboardViewProps) {
  // Manual trading console form state
  const [selectedAcc, setSelectedAcc] = useState(accounts[0]?.id || '');
  const [selectedStrat, setSelectedStrat] = useState(strategies[0]?.id || '');
  const [selectedSym, setSelectedSym] = useState(symbols[0]?.ticker || '');
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeQty, setTradeQty] = useState('10');
  const [tradePrice, setTradePrice] = useState('150');
  const [tradeNotes, setTradeNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { showError, showSuccess } = useToast();

  // --- Self-fetched recent transactions for log stream ---
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);

  const fetchRecentTransactions = async () => {
    try {
      const res = await api.ledger.list();
      const mapped = res.items.map(mapLedger);
      setRecentTransactions(mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    } catch (err) {
      console.error('[Dashboard] Error fetching recent transactions:', err);
    }
  };

  useEffect(() => {
    fetchRecentTransactions();
  }, []);

  // Synchronize initial selections based on first strategy
  useEffect(() => {
    if (strategies.length > 0 && !selectedStrat) {
      const firstStrat = strategies[0];
      setSelectedStrat(firstStrat.id);
      if (firstStrat.accountId) {
        setSelectedAcc(firstStrat.accountId);
      }
      if (firstStrat.symbols && firstStrat.symbols[0]) {
        setSelectedSym(firstStrat.symbols[0]);
        const matchedSym = symbols.find(s => s.ticker === firstStrat.symbols[0]);
        if (matchedSym) {
          setTradePrice(matchedSym.lastPrice.toString());
        }
      }
    }
  }, [strategies]);

  const handleStrategyChange = (stratId: string) => {
    setSelectedStrat(stratId);
    const matchedStrat = strategies.find(s => s.id === stratId);
    if (matchedStrat) {
      if (matchedStrat.accountId) {
        setSelectedAcc(matchedStrat.accountId);
      }
      if (matchedStrat.symbols && matchedStrat.symbols[0] && matchedStrat.symbols[0] !== 'MANUAL') {
        setSelectedSym(matchedStrat.symbols[0]);
        // Also sync price for that symbol
        const matchedSym = symbols.find(s => s.ticker === matchedStrat.symbols[0]);
        if (matchedSym) {
          setTradePrice(matchedSym.lastPrice.toString());
        }
      }
    }
  };

  const handleAccountChange = (accId: string) => {
    setSelectedAcc(accId);
    const firstStratForAcc = strategies.find(s => s.accountId === accId);
    if (firstStratForAcc) {
      setSelectedStrat(firstStratForAcc.id);
      if (firstStratForAcc.symbols && firstStratForAcc.symbols[0] && firstStratForAcc.symbols[0] !== 'MANUAL') {
        setSelectedSym(firstStratForAcc.symbols[0]);
        const matchedSym = symbols.find(sym => sym.ticker === firstStratForAcc.symbols[0]);
        if (matchedSym) {
          setTradePrice(matchedSym.lastPrice.toString());
        }
      }
    }
  };

  // Calculate high-fidelity portfolio aggregate statistics
  const totalBalance = useMemo(() => accounts.reduce((acc, a) => acc + a.balance, 0), [accounts]);
  const totalMargin = useMemo(() => accounts.reduce((acc, a) => acc + a.margin, 0), [accounts]);
  
  const totalPnl = useMemo(() => {
    return strategies.filter(s => s.name.toLowerCase() !== 'manual').reduce((acc, s) => acc + s.pnl, 0);
  }, [strategies]);

  const liveDeploymentsCount = useMemo(() => {
    return strategies.filter(s => s.status === 'active' && s.mode === 'live' && s.name.toLowerCase() !== 'manual').length;
  }, [strategies]);

  const paperDeploymentsCount = useMemo(() => {
    return strategies.filter(s => s.status === 'active' && s.mode === 'paper' && s.name.toLowerCase() !== 'manual').length;
  }, [strategies]);

  const backtestDeploymentsCount = useMemo(() => {
    return strategies.filter(s => s.status === 'active' && s.mode === 'backtest' && s.name.toLowerCase() !== 'manual').length;
  }, [strategies]);

  const avgWinRate = useMemo(() => {
    const activeStrats = strategies.filter(s => s.totalTrades > 0 && s.name.toLowerCase() !== 'manual');
    if (activeStrats.length === 0) return 0;
    return activeStrats.reduce((acc, s) => acc + s.winRate, 0) / activeStrats.length;
  }, [strategies]);

  const chartData = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return PERFORMANCE_HISTORY;
    }

    const sortedTx = [...transactions]
      .filter(tx => tx.transactionType === 'TRADE')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (sortedTx.length === 0) {
      return PERFORMANCE_HISTORY;
    }

    const strategyPnls: Record<string, number> = {};
    const points: any[] = [];
    const visibleStrats = strategies.filter(s => s.name.toLowerCase() !== 'manual');

    visibleStrats.forEach(s => {
      strategyPnls[s.id] = 0;
    });

    // Add starting point
    const startPoint: any = { time: 'Start' };
    visibleStrats.forEach(s => {
      startPoint[s.name.replace(/\s+/g, '')] = 0;
    });
    points.push(startPoint);

    sortedTx.forEach((tx) => {
      const stratId = tx.strategyId;
      if (stratId) {
        const change = tx.changeInBalance || 0;
        strategyPnls[stratId] = (strategyPnls[stratId] || 0) + change;
      }
      
      const date = new Date(tx.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      const point: any = { time: timeStr };
      visibleStrats.forEach(s => {
        const cleanName = s.name.replace(/\s+/g, '');
        point[cleanName] = parseFloat((strategyPnls[s.id] || 0).toFixed(2));
      });
      points.push(point);
    });

    return points;
  }, [transactions, strategies]);

  // Handle manual order placement
  const handlePlaceOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(tradeQty);
    const price = parseFloat(tradePrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      showError('Please specify valid numeric values for quantity and price.');
      return;
    }

    const matchedAccount = accounts.find(a => a.id === selectedAcc);
    if (matchedAccount?.status !== 'connected') {
      showError(`Selected Broker Account (${matchedAccount?.name}) is currently disconnected. Reconnect the broker API in the status panel first.`);
      return;
    }

    setIsSubmitting(true);

    const generatedId = `TX-${Math.floor(10000 + Math.random() * 90000)}`;
    const executionId = `EXE-${Math.random().toString(36).substring(2, 8)}`;
    const orderId = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const timestamp = new Date().toISOString();

    const newTx: Transaction = {
      id: generatedId,
      timestamp,
      type: tradeType,
      symbol: selectedSym,
      strategyId: selectedStrat,
      accountId: selectedAcc,
      quantity: qty,
      price: price,
      fee: parseFloat((qty * price * 0.0001 + 1.5).toFixed(2)),
      status: 'EXECUTED',
      tradeId: executionId,
      orderId: orderId,
      filledQty: qty,
      avgPrice: price,
      notes: tradeNotes || 'Manual trading execution triggered via central operator console.',
      flagged: false,
      events: [
        { time: new Date(Date.now() - 400).toISOString(), message: 'Manual trade order generated', type: 'info' },
        { time: new Date(Date.now() - 200).toISOString(), message: `Order route submitted to ${matchedAccount?.broker}`, type: 'info' },
        { time: timestamp, message: `Execution confirmed: Filled ${qty} ${selectedSym} @ ${price}`, type: 'success' },
      ],
    };

    Promise.resolve(onAddTransaction(newTx))
      .then(() => {
        setTradeNotes('');
        showSuccess(`Order ${orderId} successfully executed & settled via ${matchedAccount?.broker}!`);
        // Refresh local log stream after placing a trade
        fetchRecentTransactions();
      })
      .catch((err) => {
        console.error("Order submission failed:", err);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  // Synchronize trade price with current selected symbol's lastPrice
  const handleSymbolChange = (ticker: string) => {
    setSelectedSym(ticker);
    const matchedSym = symbols.find(s => s.ticker === ticker);
    if (matchedSym) {
      setTradePrice(matchedSym.lastPrice.toString());
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 font-sans tracking-tight">System Terminal</h2>
          <p className="text-xs text-slate-400 mt-1">
            Algorithmic portfolio overview, live broker links, and direct strategy triggers.
          </p>
        </div>
        
        {/* Network state info */}
        <div className="flex items-center gap-3 bg-slate-950 px-4 py-2 rounded-lg border border-slate-800 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <RadioIcon className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>Feed Link:</span>
            <span className="text-slate-200 font-semibold font-mono">OK</span>
          </div>
          <span className="text-slate-800">|</span>
          <div className="flex items-center gap-1.5 text-slate-400">
            <Server className="w-3.5 h-3.5 text-indigo-400" />
            <span>Engines:</span>
            <span className="text-slate-200 font-semibold font-mono">5 Running</span>
          </div>
        </div>
      </div>

      {/* Overview Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        
        {/* Net Asset Valuation (AUM) */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Assets Under Audit (AUM)</p>
            <h3 className="text-xl font-black text-slate-100 tracking-tight font-mono">
              ₹{totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-500 font-sans">
              Connected leverage capacity: <strong className="font-mono text-slate-400">₹{totalMargin.toLocaleString()}</strong>
            </p>
          </div>
          <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/10 text-indigo-400">
            <IndianRupeeIcon className="w-5 h-5" />
          </div>
        </div>

        {/* Aggregate Profits P&L */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Active Algorithmic Yield</p>
            <div className="flex items-center gap-1.5">
              <h3 className={`text-xl font-black tracking-tight font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString()}
              </h3>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5 font-bold ${
                totalPnl >= 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950/80 text-rose-400'
              }`}>
                {totalPnl >= 0 ? <ArrowUpRightIcon className="w-3 h-3" /> : <ArrowDownRightIcon className="w-3 h-3" />}
                {((totalPnl / totalBalance) * 100).toFixed(2)}%
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-sans">Cumulative strategy-generated ledger return</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/10 text-emerald-400">
            <ActivityIcon className="w-5 h-5" />
          </div>
        </div>

        {/* Active Strategy Deployments */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Active Bot Deployments</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xl font-black text-slate-100 font-mono">
                {liveDeploymentsCount + paperDeploymentsCount + backtestDeploymentsCount}
              </span>
              <span className="text-xs text-slate-400 font-sans">
                ({liveDeploymentsCount} Live, {paperDeploymentsCount} Paper, {backtestDeploymentsCount} Backtest)
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-sans">Currently deployed scanning modules</p>
          </div>
          <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/10 text-cyan-400">
            <ZapIcon className="w-5 h-5" />
          </div>
        </div>

        {/* Avg Win-Rate */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Mean Win Success Rate</p>
            <h3 className="text-xl font-black text-slate-100 tracking-tight font-mono">
              {avgWinRate.toFixed(1)}%
            </h3>
            <p className="text-[10px] text-slate-500 font-sans">
              Weighted average of all active bots
            </p>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/10 text-amber-400">
            <PercentIcon className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Column grid layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Performance Chart Block (Spans 2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4 font-sans">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-200">Deployed Strategy Yield Progression</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Temporal charting of active automated strategies (Cumulative INR return)</p>
              </div>
              <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded font-mono border border-indigo-500/10">
                15m Intervals
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#475569" 
                    fontSize={10} 
                    fontFamily="monospace"
                    tickLine={false} 
                  />
                  <YAxis 
                    stroke="#475569" 
                    fontSize={10} 
                    fontFamily="monospace"
                    tickLine={false}
                    tickFormatter={(v) => `₹${v}`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', borderRadius: '8px' }}
                    labelStyle={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: '11px' }}
                    itemStyle={{ fontSize: '11px', fontFamily: 'sans-serif' }}
                  />
                  {strategies.filter(s => s.name.toLowerCase() !== 'manual').map((s, idx) => {
                    const cleanName = s.name.replace(/\s+/g, '');
                    const colors = ['#818cf8', '#10b981', '#fbbf24', '#f87171', '#22d3ee', '#a78bfa'];
                    const color = colors[idx % colors.length];
                    return (
                      <Area 
                        key={s.id}
                        name={s.name}
                        type="monotone" 
                        dataKey={cleanName} 
                        stroke={color} 
                        strokeWidth={2}
                        fillOpacity={0.05} 
                        fill={color}
                      />
                    );
                  })}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Connected API Brokers status panel */}
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4 font-sans">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Connected Broker API Integrations</h3>
              <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Toggling brokerage status simulates dynamic API disconnects or server maintenance triggers.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {accounts.map((acc) => {
                const isConnected = acc.status === 'connected';
                return (
                  <div 
                    key={acc.id}
                    id={`broker-panel-${acc.id}`}
                    className={`p-3.5 rounded-lg border transition-all flex flex-col justify-between ${
                      isConnected 
                        ? 'bg-slate-900/40 border-slate-800' 
                        : 'bg-red-950/10 border-red-500/10 opacity-75'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500">{acc.id}</span>
                        <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                      </div>
                      <h4 className="text-xs font-bold text-slate-200 mt-1.5 truncate">{acc.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">{acc.broker}</p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                      <span className={`text-[9px] font-bold font-mono ${isConnected ? 'text-emerald-500' : 'text-red-400'}`}>
                        {isConnected ? 'ONLINE' : 'DISCONNECTED'}
                      </span>
                      <button
                        id={`toggle-conn-btn-${acc.id}`}
                        onClick={() => onToggleBrokerStatus(acc.id)}
                        className={`px-2 py-1 rounded text-[9px] font-mono font-bold border transition-colors ${
                          isConnected 
                            ? 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-900' 
                            : 'bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/30'
                        }`}
                      >
                        {isConnected ? 'Kill API' : 'Link API'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Manual Trading Console (1 column) */}
        <div className="space-y-4">
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col justify-between h-full font-sans">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-500/15 text-indigo-400 rounded-md">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Manual Operator Console</h3>
                  <p className="text-[10px] text-slate-500">Inject broker execution triggers straight to the global audit log.</p>
                </div>
              </div>

              <form onSubmit={handlePlaceOrder} className="space-y-3.5 text-xs text-slate-300">
                {/* Account Link */}
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Route Account</label>
                  <select
                    id="order-account-select"
                    value={selectedAcc}
                    onChange={(e) => handleAccountChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.status === 'connected' ? 'ON' : 'OFF'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Strategy Link */}
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Associate Strategy</label>
                  <select
                    id="order-strategy-select"
                    value={selectedStrat}
                    onChange={(e) => handleStrategyChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    {strategies
                      .filter(strat => strat.accountId === selectedAcc)
                      .map(strat => (
                        <option key={strat.id} value={strat.id}>
                          {strat.name} ({strat.mode})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Symbol Ticker */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold font-sans">Asset Symbol</label>
                    <select
                      id="order-symbol-select"
                      value={selectedSym}
                      onChange={(e) => handleSymbolChange(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 font-mono focus:outline-hidden focus:border-indigo-500"
                    >
                      {symbols.filter(sym => sym.isActive).map(sym => (
                        <option key={sym.ticker} value={sym.ticker}>
                          {sym.ticker}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Direction</label>
                    <div className="grid grid-cols-2 bg-slate-900 p-0.5 rounded-md border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setTradeType('BUY')}
                        className={`py-1.5 rounded-xs text-[10px] font-mono font-bold transition-all ${
                          tradeType === 'BUY' 
                            ? 'bg-emerald-600 text-white' 
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        BUY
                      </button>
                      <button
                        type="button"
                        onClick={() => setTradeType('SELL')}
                        className={`py-1.5 rounded-xs text-[10px] font-mono font-bold transition-all ${
                          tradeType === 'SELL' 
                            ? 'bg-rose-600 text-white' 
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        SELL
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quantity and Price */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Contract Size</label>
                    <input
                      id="order-quantity-input"
                      type="number"
                      step="any"
                      value={tradeQty}
                      onChange={(e) => setTradeQty(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 font-mono focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Limit Price</label>
                    <input
                      id="order-price-input"
                      type="number"
                      step="any"
                      value={tradePrice}
                      onChange={(e) => setTradePrice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 font-mono focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Audit Comments / Notes */}
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold font-sans">Operator Notes</label>
                  <input
                    id="order-notes-input"
                    type="text"
                    value={tradeNotes}
                    onChange={(e) => setTradeNotes(e.target.value)}
                    placeholder="Specify compliance override, audit triggers..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <button
                  id="place-order-submit-btn"
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-1.5 transition-colors font-mono cursor-pointer shadow-md disabled:opacity-50"
                >
                  <SendIcon className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Routing to Broker...' : 'Place Market Order'}
                </button>
              </form>
            </div>

            {/* Micro Live Timeline Feed */}
            <div className="mt-6 pt-5 border-t border-slate-800 font-sans">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Central Log Stream</h4>
              </div>
              
              <div className="space-y-2 max-h-[140px] overflow-y-auto divide-y divide-slate-900/60 font-mono pr-1 text-[10px]">
                {recentTransactions.slice(0, 6).map((tx, idx) => (
                  <div 
                    key={tx.id} 
                    onClick={() => onSelectTransaction(tx)}
                    className="pt-2 first:pt-0 cursor-pointer hover:text-indigo-400 transition-colors"
                  >
                    <div className="flex justify-between text-slate-400 font-semibold">
                      <span className="truncate">{tx.id} - {tx.symbol}</span>
                      <span className={`shrink-0 ml-2 ${tx.type === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>{tx.type || tx.transactionType}</span>
                    </div>
                    <p className="text-slate-500 truncate mt-0.5 text-[9px] font-sans">{tx.notes}</p>
                  </div>
                ))}
                {recentTransactions.length === 0 && (
                  <p className="text-slate-600 text-[9px] font-sans">No recent transactions.</p>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
