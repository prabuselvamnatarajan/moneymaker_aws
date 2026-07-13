/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../api';

interface CandlestickSidebarProps {
  deploymentId?: string;
  symbol: string;
  date: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function CandlestickSidebar({ deploymentId, symbol, date, isOpen, onClose }: CandlestickSidebarProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m'>('1m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candlesCount, setCandlesCount] = useState(0);

  const loadCandleData = async () => {
    setLoading(true);
    setError(null);
    try {
      let chartData: CandlestickData<Time>[] = [];
      if (deploymentId) {
        const res = await api.deployments.getCandles(deploymentId, timeframe);
        chartData = res.data.map(c => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));
      } else {
        const res = await api.symbols.getCandles(symbol, date, timeframe);
        chartData = res.data.data.map(c => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));
      }
      setCandlesCount(chartData.length);
      
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

  useEffect(() => {
    if (!isOpen || !chartContainerRef.current) return;

    // Deep slate background colors
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0f1115' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1a1e25' },
        horzLines: { color: '#1a1e25' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#232a35',
      },
      timeScale: {
        borderColor: '#232a35',
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 450,
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
    };
  }, [isOpen, deploymentId, symbol, date]);

  useEffect(() => {
    if (isOpen) {
      loadCandleData();
    }
  }, [timeframe]);


  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[480px] md:w-[520px] bg-[#15181e] border-l border-[#232a35] shadow-2xl flex flex-col transition-all duration-300 transform animate-slide-in h-screen overflow-hidden text-slate-100">
      
      {/* Control Header */}
      <div className="p-4 border-b border-[#232a35] flex items-center justify-between shrink-0 bg-[#0f1115]/60 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              Backtest Chart
            </span>
            <span className="text-xs text-slate-500 font-mono">{date}</span>
          </div>
          <h2 className="text-sm font-bold text-white mt-1 font-sans truncate max-w-[280px]">
            {symbol}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Close sidebar"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Control Actions / Timeframe Selector */}
      <div className="px-4 py-3 bg-[#0f1115]/40 border-b border-[#232a35] flex items-center shrink-0">
        <div className="flex bg-[#0f1115] rounded-lg p-0.5 border border-[#232a35]">
          {(['1m', '5m', '15m'] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                timeframe === tf
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chart Viewer */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
        
        {/* Chart Viewport Wrapper */}
        <div className="relative bg-[#0f1115] rounded-xl border border-[#232a35] overflow-hidden min-h-[450px]">
          {loading && (
            <div className="absolute inset-0 bg-[#0f1115]/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center space-y-2">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-[10px] text-slate-500 font-mono">Aggregating tick feed...</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 bg-[#0f1115] z-10 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-200">Failed to render chart</p>
                <p className="text-[10px] text-slate-500 max-w-xs">{error}</p>
              </div>
              <button
                onClick={loadCandleData}
                className="px-3 py-1 text-xs bg-slate-800 border border-slate-700 hover:border-slate-650 rounded-lg text-slate-350 hover:text-white transition-all cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && candlesCount === 0 && (
            <div className="absolute inset-0 bg-[#0f1115] z-10 flex flex-col items-center justify-center p-6 text-center space-y-2">
              <p className="text-xs font-semibold text-slate-400">No Tick Data Available</p>
              <p className="text-[10px] text-slate-600 max-w-xs">
                Historical JSON file was not found or contains no price data for this backtest date.
              </p>
            </div>
          )}

          <div ref={chartContainerRef} className="w-full h-[450px]" />
        </div>

        {/* Info Card / Metadata */}
        <div className="bg-[#0f1115]/40 border border-[#232a35]/80 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wide">
            Chart Specifications
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="space-y-0.5">
              <span className="text-slate-500 text-[10px]">Backtest Date</span>
              <p className="text-slate-300 font-medium">{date}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-slate-500 text-[10px]">Timeframe</span>
              <p className="text-slate-300 font-medium">
                {timeframe === '1m' ? '1 Minute' : timeframe === '5m' ? '5 Minutes' : '15 Minutes'}
              </p>
            </div>
            <div className="space-y-0.5">
              <span className="text-slate-500 text-[10px]">Total Candles</span>
              <p className="text-slate-300 font-medium">{candlesCount}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-slate-500 text-[10px]">Render Method</span>
              <p className="text-slate-300 font-medium text-emerald-400">Canvas 2D API</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
