/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { 
  LineChart, TrendingUp, TrendingDown, Clock, Activity, ArrowLeft, 
  Layers, ExternalLink, RefreshCw, BarChart3, HelpCircle, ArrowUpRight, Power,
  AlertTriangle, Edit, Trash2, X
} from 'lucide-react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { SymbolData, Transaction, Strategy } from '../types';
import TransactionList from './TransactionList';
import { api } from '../api';
import { mapTrade } from '../adapters';

interface SymbolDetailsViewProps {
  symbol: SymbolData;
  strategies: Strategy[];
  onBackToDashboard: () => void;
  onNavigateToEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  onSelectTransaction: (tx: Transaction) => void;
  onDrilldownToTransactions: (filterKey: 'symbol', filterValue: string) => void;
  timezone: string;
  onNavigateToScreen?: (screen: any) => void;
  onRefreshData?: () => Promise<void> | void;
  onToggleSymbolActive?: (id: string, isActive: boolean) => void;
  onEditSymbol?: (id: string, updateData: any) => Promise<void> | void;
  onDeleteSymbol?: (id: string, ticker: string) => Promise<void> | void;
}

export default function SymbolDetailsView({
  symbol,
  strategies,
  onBackToDashboard,
  onNavigateToEntity,
  onSelectTransaction,
  onDrilldownToTransactions,
  timezone,
  onNavigateToScreen,
  onRefreshData,
  onToggleSymbolActive,
  onEditSymbol,
  onDeleteSymbol,
}: SymbolDetailsViewProps) {
  const [toggling, setToggling] = useState(false);

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
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSymbol || !onDeleteSymbol) return;
    try {
      await onDeleteSymbol(deletingSymbol.id || deletingSymbol.ticker, deletingSymbol.ticker);
      setDeletingSymbol(null);
      onBackToDashboard(); // return on delete
    } catch (err) {
      console.error(err);
    }
  };

  // --- Candlestick Chart Integration ---
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<any>(null);

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [chartDate, setChartDate] = useState('');

  // Fetch available backtest dates from server
  useEffect(() => {
    const fetchDates = async () => {
      try {
        const res = await api.symbols.getBacktestDates();
        if (res.data && res.data.length > 0) {
          setAvailableDates(res.data);
          setChartDate(res.data[0]);
        }
      } catch (err: any) {
        console.error('Error fetching backtest dates:', err);
        const fallback = ['2026-06-24', '2026-06-18', '2026-06-17'];
        setAvailableDates(fallback);
        setChartDate(fallback[0]);
      }
    };
    fetchDates();
  }, []);
  const [chartTimeframe, setChartTimeframe] = useState<'1m' | '5m' | '15m'>('1m');
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [candlesCount, setCandlesCount] = useState(0);

  const loadCandleData = async () => {
    if (!symbol?.ticker || !chartDate) return;
    setChartLoading(true);
    setChartError(null);
    try {
      const res = await api.symbols.getCandles(symbol.ticker, chartDate, chartTimeframe);
      const chartData: CandlestickData<Time>[] = res.data.data.map(c => {
        const rawTime = c.time;
        // lightweight-charts renders UTC by default.
        // UTC mode: rawTime directly → shows 03:45 UTC ✓
        // Local/IST mode: rawTime - getTimezoneOffset*60 → for IST (offset=-330): +19800s → shows 09:15 ✓
        const adjustedTime = timezone === 'UTC'
          ? rawTime
          : (rawTime - (new Date(rawTime * 1000).getTimezoneOffset() * 60));
        return {
          time: adjustedTime as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        };
      });
      setCandlesCount(chartData.length);
      
      if (chartData.length > 0) {
        lastBarRef.current = chartData[chartData.length - 1];
      } else {
        lastBarRef.current = null;
      }

      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData(chartData);
        if (chartRef.current && chartData.length > 0) {
          chartRef.current.timeScale().fitContent();
        }
      }
    } catch (err: any) {
      console.error('Error fetching candles:', err);
      setChartError(err.message || 'Failed to load candle data');
    } finally {
      setChartLoading(false);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current || !chartDate) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#020617' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 380,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

    loadCandleData();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      lastBarRef.current = null;
    };
  }, [symbol?.ticker, chartDate, timezone]);

  useEffect(() => {
    loadCandleData();
  }, [chartTimeframe]);

  // Real-time tick update hook
  useEffect(() => {
    if (!candlestickSeriesRef.current || !symbol || !lastBarRef.current) return;
    const price = symbol.lastPrice;
    if (price === undefined || price === null) return;

    const lastBar = lastBarRef.current;
    const lastBarTimeNum = lastBar.time as number;

    let intervalSec = 60;
    if (chartTimeframe === '5m') intervalSec = 5 * 60;
    else if (chartTimeframe === '15m') intervalSec = 15 * 60;

    const rawBucketTime = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
    const currentBucketTime = timezone === 'UTC'
      ? rawBucketTime
      : (rawBucketTime - (new Date(rawBucketTime * 1000).getTimezoneOffset() * 60));

    let updatedBar: CandlestickData<Time>;
    if (currentBucketTime <= lastBarTimeNum) {
      updatedBar = {
        time: lastBar.time,
        open: lastBar.open,
        high: Math.max(lastBar.high, price),
        low: Math.min(lastBar.low, price),
        close: price
      };
    } else {
      updatedBar = {
        time: currentBucketTime as Time,
        open: price,
        high: price,
        low: price,
        close: price
      };
      lastBarRef.current = updatedBar;
    }

    candlestickSeriesRef.current.update(updatedBar);
  }, [symbol?.lastPrice, chartTimeframe, timezone]);


  // --- Self-fetched transactions for this symbol ---
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    if (!symbol?.ticker) return;
    setTxLoading(true);
    setTxError(null);
    try {
      // Fetch trades server-side filtered by symbol
      const tradesRes = await api.trades.listForSymbol(symbol.ticker);
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
  }, [symbol?.ticker]);

  // Find strategies associated with this symbol
  const activeStrategies = strategies.filter((strat) => 
    strat.symbols.map(s => s.toUpperCase()).includes(symbol.ticker.toUpperCase())
  );

  const isPositive = symbol.change24h >= 0;

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
          onClick={() => onNavigateToScreen?.('symbols-list')}
          className="text-slate-400 font-mono hover:text-indigo-400 transition-colors cursor-pointer"
        >
          Symbols
        </button>
        <span>/</span>
        <button
          onClick={() => onNavigateToScreen?.('symbols-list')}
          className="text-slate-200 font-bold hover:text-indigo-400 transition-colors cursor-pointer"
        >
          {symbol.name || symbol.ticker}
        </button>
      </div>

      {/* Main Header Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 font-sans">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-900 rounded-lg text-indigo-400 border border-slate-800">
            <LineChart className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black text-white tracking-tight">{symbol.name || symbol.ticker}</h2>
              <span className="text-[10px] uppercase font-mono tracking-wider font-semibold bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                {symbol.instrumentType}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5 font-sans">
              <span className="font-mono text-slate-400 lowercase" title="Instrument Token / Ticker (Server communication ID)">
                {symbol.instrumentToken ? symbol.instrumentToken.toLowerCase() : symbol.ticker.toLowerCase()}
              </span>
              {symbol.instrumentToken && symbol.instrumentToken !== symbol.ticker && (
                <span className="font-mono text-[10px] text-slate-600 lowercase">
                  ({symbol.ticker.toLowerCase()})
                </span>
              )}
              <span className="text-slate-600">•</span>
              <span>Traded via {symbol.exchange}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Active/Inactive Status Badge */}
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono tracking-wider font-bold uppercase border ${
            symbol.isActive
              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30'
              : 'bg-slate-900 text-slate-450 border-slate-800'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${symbol.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {symbol.isActive ? 'Active Feed' : 'Inactive'}
          </span>

          {/* Toggle Active/Inactive Button */}
          {onToggleSymbolActive && symbol.id && (
            <button
              id="btn-symbol-detail-toggle-active"
              disabled={toggling}
              onClick={async () => {
                setToggling(true);
                try {
                  await onToggleSymbolActive(symbol.id!, !symbol.isActive);
                } finally {
                  setToggling(false);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer border disabled:opacity-50 ${
                symbol.isActive
                  ? 'text-rose-400 hover:text-rose-300 bg-rose-950/20 border-rose-900/30 hover:bg-rose-900/20'
                  : 'text-emerald-400 hover:text-emerald-300 bg-emerald-950/20 border-emerald-900/30 hover:bg-emerald-900/20'
              }`}
            >
              <Power className={`w-3.5 h-3.5 ${toggling ? 'animate-spin' : ''}`} />
              {symbol.isActive ? 'Deactivate' : 'Activate'}
            </button>
          )}

          {onEditSymbol && (
            <button
              onClick={() => handleOpenEdit(symbol)}
              className="p-2 text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 border border-slate-800 rounded-md transition-colors cursor-pointer"
              title="Edit Symbol"
            >
              <Edit className="w-4 h-4" />
            </button>
          )}

          {onDeleteSymbol && (
            <button
              onClick={() => setDeletingSymbol(symbol)}
              className="p-2 text-rose-450 hover:text-rose-400 hover:bg-slate-900 border border-slate-800 rounded-md transition-colors cursor-pointer"
              title="Delete Symbol"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-md border border-slate-800">
            {(() => {
              const lat = symbol.latency_ms;
              const color = lat == null 
                ? 'text-indigo-400' 
                : lat < 100 
                ? 'text-emerald-400' 
                : lat <= 300 
                ? 'text-amber-400' 
                : 'text-rose-400';
              return (
                <>
                  <Clock className={`w-3.5 h-3.5 ${color}`} />
                  LATENCY: {lat != null ? `${lat}ms` : 'DELAYLESS 200ms'}
                </>
              );
            })()}
          </span>
        </div>
      </div>

      {/* Snapshot Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-sans">
        
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
      <div className="bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 space-y-4 font-sans">
        <div>
          <h3 className="text-sm font-bold text-slate-200">Active Strategies Deployed on {symbol.name || symbol.ticker}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Strategies configured to analyze and execute contract orders on this asset.</p>
        </div>

        {activeStrategies.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Candlestick Chart Card */}
      <div className="bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 space-y-4 font-sans">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Asset Candlestick Chart</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Aggregated tick-by-tick transaction history candles.</p>
          </div>
          
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date Select */}
            <select
              value={chartDate}
              onChange={(e) => setChartDate(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-md p-1.5 text-xs text-slate-300 font-mono focus:outline-hidden focus:border-indigo-500"
            >
              {availableDates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            {/* Timeframe selector */}
            <div className="flex bg-slate-900 rounded p-0.5 border border-slate-800">
              {(['1m', '5m', '15m'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => setChartTimeframe(tf)}
                  className={`px-2 py-1 text-[10px] font-semibold rounded transition-all cursor-pointer ${
                    chartTimeframe === tf
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Reload Chart */}
            <div className="flex items-center gap-1">
              <button
                onClick={loadCandleData}
                disabled={chartLoading}
                className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-455 hover:text-slate-200 transition-colors border border-slate-850 cursor-pointer disabled:opacity-50"
                title="Reload Chart"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${chartLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Viewport Wrapper */}
        <div className="relative bg-[#020617] rounded-lg border border-slate-800 overflow-hidden min-h-[380px]">
          {chartLoading && (
            <div className="absolute inset-0 bg-[#020617]/85 backdrop-blur-xs z-10 flex flex-col items-center justify-center space-y-2">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-[10px] text-slate-500 font-mono">Loading data...</p>
            </div>
          )}

          {chartError && (
            <div className="absolute inset-0 bg-[#020617] z-10 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-350">Failed to render chart</p>
                <p className="text-[10px] text-slate-500 max-w-xs">{chartError}</p>
              </div>
              <button
                onClick={loadCandleData}
                className="px-2.5 py-1 text-[10px] bg-slate-900 border border-slate-800 rounded text-slate-450 hover:text-white transition-all cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {!chartLoading && !chartError && candlesCount === 0 && (
            <div className="absolute inset-0 bg-[#020617] z-10 flex flex-col items-center justify-center p-6 text-center space-y-2">
              <p className="text-xs font-semibold text-slate-455">No Data For Chosen Date</p>
              <p className="text-[10px] text-slate-600 max-w-xs">
                No tick feed has been exported for {symbol.ticker} on {chartDate}.
              </p>
            </div>
          )}

          <div ref={chartContainerRef} className="w-full h-[380px]" />
        </div>
      </div>

      {/* Transactions list section — dynamically fetched */}
      <div className="pt-4 border-t border-slate-800 font-sans">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Symbol Trade History</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Live-fetched from server for this symbol — no client-side filtering.
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
            strategies={strategies}
            variant="compact"
            timezone={timezone}
            onRowClick={onSelectTransaction}
            onViewAllDrilldown={() => onDrilldownToTransactions('symbol', symbol.ticker)}
          />
        )}
      </div>

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
                  id="edit-sym-is-active-details"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-3.5 h-3.5 bg-slate-955 border-slate-800 rounded focus:ring-0 text-indigo-600 focus:ring-offset-0"
                />
                <label htmlFor="edit-sym-is-active-details" className="text-xs text-slate-350 select-none cursor-pointer">
                  Activate Live Feed Subscription
                </label>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingSymbol(null)}
                  className="px-4 py-2 bg-slate-955 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
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
                  id="btn-confirm-delete-symbol-details"
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
