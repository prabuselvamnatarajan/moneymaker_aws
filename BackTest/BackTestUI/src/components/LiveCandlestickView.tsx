/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { 
  LineChart, TrendingUp, TrendingDown, Clock, Activity, 
  AlertTriangle, RefreshCw 
} from 'lucide-react';
import { SymbolData } from '../types';
import { api } from '../api';

interface LiveCandlestickViewProps {
  symbols: SymbolData[];
  timezone: string;
}

export default function LiveCandlestickView({ symbols, timezone }: LiveCandlestickViewProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<CandlestickData<Time> | null>(null);

  const activeSymbols = symbols.filter(s => s.isActive);
  const [selectedSymbol, setSelectedSymbol] = useState(activeSymbols[0]?.ticker || symbols[0]?.ticker || '');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m'>('1m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candlesCount, setCandlesCount] = useState(0);

  const matchedSymbolObj = symbols.find(s => s.ticker === selectedSymbol);

  // Fetch available backtest dates from server
  useEffect(() => {
    const fetchDates = async () => {
      try {
        const res = await api.symbols.getBacktestDates();
        if (res.data && res.data.length > 0) {
          setAvailableDates(res.data);
          setSelectedDate(res.data[0]);
        }
      } catch (err: any) {
        console.error('Error fetching backtest dates:', err);
        const fallback = ['2026-06-24', '2026-06-18', '2026-06-17'];
        setAvailableDates(fallback);
        setSelectedDate(fallback[0]);
      }
    };
    fetchDates();
  }, []);

  const loadCandleData = async () => {
    if (!selectedSymbol || !selectedDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.symbols.getCandles(selectedSymbol, selectedDate, timeframe);
      const chartData: CandlestickData<Time>[] = res.data.data.map(c => {
        const rawTime = c.time;
        const adjustedTime = timezone === 'UTC'
          ? (rawTime + (new Date(rawTime * 1000).getTimezoneOffset() * 60))
          : rawTime;
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
      setError(err.message || 'Failed to load candle data');
    } finally {
      setLoading(false);
    }
  };

  // Setup lightweight-charts instance
  useEffect(() => {
    if (!chartContainerRef.current || !selectedDate) return;

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
      height: 480,
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
  }, [selectedSymbol, selectedDate, timezone]);

  // Handle timeframe changes
  useEffect(() => {
    loadCandleData();
  }, [timeframe]);

  // Real-time tick update subscription hook
  useEffect(() => {
    if (!candlestickSeriesRef.current || !matchedSymbolObj || !lastBarRef.current) return;
    const price = matchedSymbolObj.lastPrice;
    if (price === undefined || price === null) return;

    const lastBar = lastBarRef.current;
    const lastBarTimeNum = lastBar.time as number;

    // Determine timeframe interval in seconds
    let intervalSec = 60;
    if (timeframe === '5m') intervalSec = 5 * 60;
    else if (timeframe === '15m') intervalSec = 15 * 60;

    const rawBucketTime = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
    const currentBucketTime = timezone === 'UTC'
      ? (rawBucketTime + (new Date(rawBucketTime * 1000).getTimezoneOffset() * 60))
      : rawBucketTime;

    // If it falls in the current bucket, update last candle, otherwise start a new one
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
  }, [matchedSymbolObj?.lastPrice, timeframe, timezone]);


  const isPositive = matchedSymbolObj ? matchedSymbolObj.change24h >= 0 : true;

  return (
    <div className="space-y-6">
      
      {/* Header and Controls Row */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-slate-950 p-4 sm:p-6 rounded-xl border border-slate-800 font-sans">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-900 rounded-lg text-pink-400 border border-slate-800">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">Live Candlestick Console</h2>
            <p className="text-xs text-slate-400 mt-1">
              Real-time candlestick graphing and tick streaming engine audits.
            </p>
          </div>
        </div>

        {/* Filters and Selectors */}
        <div className="flex flex-wrap items-center gap-3 text-xs w-full lg:w-auto">
          {/* Symbol Selector */}
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-[10px] text-slate-500 uppercase font-mono font-semibold">Select Symbol</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 font-mono focus:outline-hidden focus:border-indigo-500 w-full sm:w-44"
            >
              {symbols.map(sym => (
                <option key={sym.ticker} value={sym.ticker}>
                  {sym.name || sym.ticker} {sym.isActive ? '(Active)' : '(Inactive)'}
                </option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-[10px] text-slate-500 uppercase font-mono font-semibold">Backtest Date</label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 font-mono focus:outline-hidden focus:border-indigo-500 w-full sm:w-36"
            >
              {availableDates.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Timeframe Selector */}
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-[10px] text-slate-500 uppercase font-mono font-semibold">Timeframe</label>
            <div className="flex bg-slate-900 rounded-md p-0.5 border border-slate-800 h-[38px] items-center">
              {(['1m', '5m', '15m'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    timeframe === tf
                      ? 'bg-slate-800 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Chart + Specs Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Candlestick Chart Window (Spans 3 cols) */}
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4">
            
              <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-indigo-400" />
                  Tick Aggregated Candles
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={loadCandleData}
                  disabled={loading}
                  className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-350 hover:text-white transition-colors border border-slate-800 cursor-pointer disabled:opacity-50"
                  title="Refresh Data"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="relative bg-[#020617] rounded-lg border border-slate-800 overflow-hidden min-h-[480px]">
              {loading && (
                <div className="absolute inset-0 bg-[#020617]/80 backdrop-blur-xs z-10 flex flex-col items-center justify-center space-y-2">
                  <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] text-slate-500 font-mono">Aggregating symbol ticks...</p>
                </div>
              )}

              {error && (
                <div className="absolute inset-0 bg-[#020617] z-10 flex flex-col items-center justify-center p-6 text-center space-y-3">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-200">Failed to render chart</p>
                    <p className="text-[10px] text-slate-500 max-w-xs">{error}</p>
                  </div>
                  <button
                    onClick={loadCandleData}
                    className="px-3 py-1 text-xs bg-slate-850 border border-slate-700 hover:border-slate-600 rounded-lg text-slate-300 hover:text-white transition-all cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loading && !error && candlesCount === 0 && (
                <div className="absolute inset-0 bg-[#020617] z-10 flex flex-col items-center justify-center p-6 text-center space-y-2">
                  <p className="text-xs font-semibold text-slate-400">No Tick Data Available</p>
                  <p className="text-[10px] text-slate-600 max-w-xs">
                    Historical JSON file was not found or contains no price data for {selectedSymbol} on {selectedDate}.
                  </p>
                </div>
              )}

              <div ref={chartContainerRef} className="w-full h-[480px]" />
            </div>

          </div>
        </div>

        {/* Specifications / Live Quote Panel (1 col) */}
        <div className="space-y-4">
          <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-6 h-full font-sans">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Symbol Info</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Asset metadata and live metrics.</p>
            </div>

            {matchedSymbolObj ? (
              <div className="space-y-4">
                {/* Symbol Ticker */}
                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-mono text-slate-500 uppercase">Ticker / Token</span>
                  <h4 className="text-xs font-bold text-slate-200 mt-1 font-mono truncate">{matchedSymbolObj.ticker}</h4>
                  <p className="text-[9px] text-slate-500 font-mono mt-0.5 lowercase">{matchedSymbolObj.instrumentToken || 'no token'}</p>
                </div>

                {/* Live Quote Card */}
                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-mono text-slate-500 uppercase">Current Rate</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <h4 className="text-base font-black text-slate-100 font-mono">
                      ₹{matchedSymbolObj.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </h4>
                    <span className={`text-[10px] font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? '+' : ''}{matchedSymbolObj.change24h}%
                    </span>
                  </div>
                </div>

                {/* Specifications Grid */}
                <div className="space-y-3 pt-3 border-t border-slate-800">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Specifications</h4>
                  
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="space-y-0.5">
                      <span className="text-slate-500">Exchange</span>
                      <p className="text-slate-350">{matchedSymbolObj.exchange}</p>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-slate-500">Asset Class</span>
                      <p className="text-slate-350">{matchedSymbolObj.instrumentClass || matchedSymbolObj.instrumentType.toUpperCase()}</p>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-slate-500">Timeframe</span>
                      <p className="text-slate-350">{timeframe === '1m' ? '1m Candle' : timeframe === '5m' ? '5m Candle' : '15m Candle'}</p>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-slate-500">Total Candles</span>
                      <p className="text-slate-350">{candlesCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No symbol metadata available.</p>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
