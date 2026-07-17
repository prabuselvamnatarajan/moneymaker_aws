/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, DollarSign, ArrowUpRight, ArrowDownRight, Calendar, Search, Clock } from 'lucide-react';
import { createChart, IChartApi, ISeriesApi, Time, AreaSeries, HistogramSeries } from 'lightweight-charts';
import { DeploymentAnalysis, TimeSeriesDataPoint, IntradayTradeDataPoint, Deployment, Position } from '../types';
import { api } from '../api';
import { useToast } from './Toast';
import CandlestickSidebar from './CandlestickSidebar';
import SweepSignalLogView from './SweepSignalLogView';
import PositionsList from './PositionsList';
import { mapPosition } from '../adapters';

interface DeploymentAnalysisViewProps {
  selectedDeploymentId: string | null;
  timezone?: string;
  onSelectTransaction?: (tx: any) => void;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const SECOND_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const convertDateTimeZone = (dateStr: string, timeStr: string, defaultTime: string, fromTz: string, toTz: string) => {
  if (!dateStr) return { date: '', time: '' };
  
  const t = timeStr || defaultTime;
  let d: Date;
  if (fromTz === 'UTC') {
    d = new Date(`${dateStr}T${t}Z`);
  } else {
    d = new Date(`${dateStr}T${t}`);
  }
  
  if (isNaN(d.getTime())) return { date: dateStr, time: timeStr };
  
  let year: number, month: number, date: number, hour: number, minute: number, second: number;
  if (toTz === 'UTC') {
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    date = d.getUTCDate();
    hour = d.getUTCHours();
    minute = d.getUTCMinutes();
    second = d.getUTCSeconds();
  } else {
    year = d.getFullYear();
    month = d.getMonth() + 1;
    date = d.getDate();
    hour = d.getHours();
    minute = d.getMinutes();
    second = d.getSeconds();
  }
  
  const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return { date: formattedDate, time: formattedTime };
};

const getNiceTicks = (min: number, max: number, targetTicks: number = 6): number[] => {
  if (isNaN(min) || isNaN(max) || !isFinite(min) || !isFinite(max) || min >= max) {
    return [];
  }
  
  const range = max - min;
  const rawStep = range / (targetTicks - 1);
  if (rawStep <= 0) return [min];
  
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  
  let cleanStep: number;
  if (residual < 1.5) {
    cleanStep = 1 * magnitude;
  } else if (residual < 3.5) {
    cleanStep = 2 * magnitude;
  } else if (residual < 7.5) {
    cleanStep = 5 * magnitude;
  } else {
    cleanStep = 10 * magnitude;
  }
  
  const startTick = Math.ceil(min / cleanStep) * cleanStep;
  const ticks: number[] = [];
  let t = startTick;
  const eps = cleanStep * 0.0001;
  
  while (t <= max + eps) {
    ticks.push(Number(t.toFixed(10)));
    t += cleanStep;
  }
  
  if (ticks.length < 2) {
    return [min, max];
  }
  
  return ticks;
};

export default function DeploymentAnalysisView({ selectedDeploymentId, timezone = 'UTC', onSelectTransaction }: DeploymentAnalysisViewProps) {
  const { showError } = useToast();
  
  const [deploymentId, setDeploymentId] = useState<string>('');
  const [isChartOpen, setIsChartOpen] = useState(false);
  
  const prevTimezoneRef = useRef<string>(timezone);

  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');



  const startHour = startTime.split(':')[0] || '00';
  const startMin = startTime.split(':')[1] || '00';
  const startSec = startTime.split(':')[2] || '00';

  const endHour = endTime.split(':')[0] || '23';
  const endMin = endTime.split(':')[1] || '59';
  const endSec = endTime.split(':')[2] || '59';

  const handleStartHourChange = (val: string) => {
    const currentMin = startTime.split(':')[1] || '00';
    const currentSec = startTime.split(':')[2] || '00';
    setStartTime(`${val}:${currentMin}:${currentSec}`);
  };
  const handleStartMinuteChange = (val: string) => {
    const currentHour = startTime.split(':')[0] || '00';
    const currentSec = startTime.split(':')[2] || '00';
    setStartTime(`${currentHour}:${val}:${currentSec}`);
  };
  const handleStartSecondChange = (val: string) => {
    const currentHour = startTime.split(':')[0] || '00';
    const currentMin = startTime.split(':')[1] || '00';
    setStartTime(`${currentHour}:${currentMin}:${val}`);
  };

  const handleEndHourChange = (val: string) => {
    const currentMin = endTime.split(':')[1] || '59';
    const currentSec = endTime.split(':')[2] || '59';
    setEndTime(`${val}:${currentMin}:${currentSec}`);
  };
  const handleEndMinuteChange = (val: string) => {
    const currentHour = endTime.split(':')[0] || '23';
    const currentSec = endTime.split(':')[2] || '59';
    setEndTime(`${currentHour}:${val}:${currentSec}`);
  };
  const handleEndSecondChange = (val: string) => {
    const currentHour = endTime.split(':')[0] || '23';
    const currentMin = endTime.split(':')[1] || '59';
    setEndTime(`${currentHour}:${currentMin}:${val}`);
  };
  const [analysis, setAnalysis] = useState<DeploymentAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [chartData, setChartData] = useState<TimeSeriesDataPoint[]>([]);
  const [intradayData, setIntradayData] = useState<IntradayTradeDataPoint[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [defaultDomain, setDefaultDomain] = useState<[number, number]>([0, 24]);

  // Positions list state
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set());
  const [analysisPanel, setAnalysisPanel] = useState<'performance' | 'sweepSignals'>('performance');
  const [isLiquiditySweep, setIsLiquiditySweep] = useState(false);

  // --- lightweight-charts integration ---
  const pnlChartContainerRef = useRef<HTMLDivElement>(null);
  const pnlChartRef = useRef<IChartApi | null>(null);
  const pnlSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  const intraChartContainerRef = useRef<HTMLDivElement>(null);
  const intraChartRef = useRef<IChartApi | null>(null);
  const intraSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const pnlSeriesData = useMemo(() => {
    const sorted = [...chartData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    // lightweight-charts renders as UTC. For local/IST mode we shift time forward by the browser offset
    // so the UTC label on the chart shows the IST time (e.g. 09:15 instead of 03:45).
    const tzShift = timezone === 'UTC' ? 0 : -(new Date().getTimezoneOffset() * 60);
    const mapped = sorted.map(pt => ({
      time: Math.floor(new Date(pt.timestamp).getTime() / 1000) + tzShift,
      value: pt.pnl,
    }));
    
    const uniqueData: { time: number; value: number }[] = [];
    let lastTime = 0;
    for (const item of mapped) {
      let t = item.time;
      if (t <= lastTime) {
        t = lastTime + 1;
      }
      uniqueData.push({ time: t, value: item.value });
      lastTime = t;
    }
    return uniqueData;
  }, [chartData, timezone]);

  const intradaySeriesData = useMemo(() => {
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    // lightweight-charts renders as UTC. new Date().setHours() uses local timezone,
    // so the resulting epoch already encodes local time. We need to shift it so the
    // chart's UTC label shows the correct local time.
    // For IST: tzShift = -(-330*60) = +19800s. For UTC: tzShift = 0.
    const tzShift = timezone === 'UTC' ? 0 : -(new Date().getTimezoneOffset() * 60);
    const mapped = intradayData.map(trade => {
      const tradeDate = new Date(baseDate);
      tradeDate.setHours(trade.hour, trade.minute, trade.second, 0);
      return {
        time: (Math.floor(tradeDate.getTime() / 1000) + tzShift) as Time,
        value: trade.pnl,
        color: trade.pnl >= 0 ? '#10b981' : '#ef4444',
      };
    });
    
    mapped.sort((a, b) => (a.time as number) - (b.time as number));
    
    const uniqueData: typeof mapped = [];
    let lastTime = 0;
    for (const item of mapped) {
      let t = item.time as number;
      if (t <= lastTime) {
        t = lastTime + 1;
      }
      uniqueData.push({ ...item, time: t as Time });
      lastTime = t;
    }
    return uniqueData;
  }, [intradayData, timezone]);

  // Set up P&L Chart
  useEffect(() => {
    if (!pnlChartContainerRef.current) return;

    const chart = createChart(pnlChartContainerRef.current, {
      layout: {
        background: { color: '#0f172a' },
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
        secondsVisible: true,
      },
      width: pnlChartContainerRef.current.clientWidth,
      height: 380,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#6366f1',
      topColor: 'rgba(99, 102, 241, 0.2)',
      bottomColor: 'rgba(99, 102, 241, 0)',
      lineWidth: 2,
    });

    series.applyOptions({
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `₹${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    });

    pnlChartRef.current = chart;
    pnlSeriesRef.current = series;

    const handleResize = () => {
      if (pnlChartContainerRef.current && pnlChartRef.current) {
        pnlChartRef.current.applyOptions({ width: pnlChartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      pnlChartRef.current = null;
      pnlSeriesRef.current = null;
    };
  }, [analysis]);

  // Update P&L Chart data
  useEffect(() => {
    if (pnlSeriesRef.current && pnlSeriesData.length > 0) {
      pnlSeriesRef.current.setData(pnlSeriesData);
      if (pnlChartRef.current) {
        pnlChartRef.current.timeScale().fitContent();
      }
    }
  }, [pnlSeriesData]);

  // Set up Intraday Chart
  useEffect(() => {
    if (!intraChartContainerRef.current) return;

    const chart = createChart(intraChartContainerRef.current, {
      layout: {
        background: { color: '#0f172a' },
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
        secondsVisible: true,
      },
      width: intraChartContainerRef.current.clientWidth,
      height: 380,
    });

    const series = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `₹${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    });

    intraChartRef.current = chart;
    intraSeriesRef.current = series;

    const handleResize = () => {
      if (intraChartContainerRef.current && intraChartRef.current) {
        intraChartRef.current.applyOptions({ width: intraChartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      intraChartRef.current = null;
      intraSeriesRef.current = null;
    };
  }, [analysis]);

  // Update Intraday Chart data
  useEffect(() => {
    if (intraSeriesRef.current && intradaySeriesData.length > 0) {
      intraSeriesRef.current.setData(intradaySeriesData);
      if (intraChartRef.current) {
        intraChartRef.current.timeScale().fitContent();
      }
    }
  }, [intradaySeriesData]);

  useEffect(() => {
    if (selectedDeploymentId) {
      setDeploymentId(selectedDeploymentId);
    }
  }, [selectedDeploymentId]);

  useEffect(() => {
    if (!deploymentId) {
      setIsLiquiditySweep(false);
      return;
    }
    api.deployments.get(deploymentId).then((res) => {
      const strategyName = res.data?.strategy_id?.strategy_name || '';
      setIsLiquiditySweep(strategyName === 'liquidity_sweep');
    }).catch(() => setIsLiquiditySweep(false));
  }, [deploymentId]);

  // Fetch user's deployments on mount
  useEffect(() => {
    const fetchDeployments = async () => {
      try {
        const result = await api.deployments.list();
        setDeployments(result.items || []);
      } catch (err: any) {
        console.error('Failed to fetch deployments:', err.message);
      }
    };
    fetchDeployments();
  }, []);

  useEffect(() => {
    const prevTz = prevTimezoneRef.current;
    if (prevTz !== timezone) {
      if (startDate) {
        const converted = convertDateTimeZone(startDate, startTime, '00:00:00', prevTz, timezone);
        setStartDate(converted.date);
        setStartTime(converted.time);
      }
      if (endDate) {
        const converted = convertDateTimeZone(endDate, endTime, '23:59:59', prevTz, timezone);
        setEndDate(converted.date);
        setEndTime(converted.time);
      }
      prevTimezoneRef.current = timezone;
    }
  }, [timezone, startDate, startTime, endDate, endTime]);

  useEffect(() => {
    if (!analysis) {
      setIntradayData([]);
      setDefaultDomain([0, 24]);
      return;
    }

    const rawIntraday = analysis.intraday_trades || [];
    const processedIntraday = rawIntraday.map((trade: any) => {
      const d = new Date(trade.timestamp);
      let h = trade.hour;
      let m = trade.minute;
      let s = trade.second;

      if (timezone === 'UTC') {
        h = d.getUTCHours();
        m = d.getUTCMinutes();
        s = d.getUTCSeconds();
      } else {
        h = d.getHours();
        m = d.getMinutes();
        s = d.getSeconds();
      }

      const timeOfDay = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      return {
        ...trade,
        hour: h,
        minute: m,
        second: s,
        time_of_day: timeOfDay,
      };
    });

    setIntradayData(processedIntraday);

    // Calculate the default zoom domain based on trade density
    if (processedIntraday.length > 0) {
      const hourBuckets = new Map<number, number>();
      for (let i = 0; i < 24; i++) {
        hourBuckets.set(i, 0);
      }
      
      processedIntraday.forEach((trade: any) => {
        const count = hourBuckets.get(trade.hour) || 0;
        hourBuckets.set(trade.hour, count + 1);
      });
      
      let maxHour = 0;
      let maxCount = 0;
      hourBuckets.forEach((count, hour) => {
        if (count > maxCount) {
          maxCount = count;
          maxHour = hour;
        }
      });
      
      const startHour = Math.max(0, maxHour - 3);
      const endHour = Math.min(24, maxHour + 3);
      setDefaultDomain([startHour, endHour]);
    } else {
      setDefaultDomain([0, 24]);
    }
  }, [analysis, timezone]);

  const fetchAnalysis = async () => {
    const idToFetch = deploymentId.trim();
    if (!idToFetch) {
      showError('Please select a deployment');
      return;
    }

    setIsLoading(true);
    try {
      let finalStart: string | undefined = undefined;
      let finalEnd: string | undefined = undefined;

      if (startDate) {
        const startT = startTime || '00:00:00';
        if (timezone === 'UTC') {
          finalStart = `${startDate}T${startT}Z`;
        } else {
          const localDate = new Date(`${startDate}T${startT}`);
          if (!isNaN(localDate.getTime())) {
            finalStart = localDate.toISOString();
          }
        }
      }

      if (endDate) {
        const endT = endTime || '23:59:59';
        if (timezone === 'UTC') {
          finalEnd = `${endDate}T${endT}Z`;
        } else {
          const localDate = new Date(`${endDate}T${endT}`);
          if (!isNaN(localDate.getTime())) {
            finalEnd = localDate.toISOString();
          }
        }
      }

      const result = await api.deployments.getAnalysis(
        idToFetch,
        finalStart,
        finalEnd,
        undefined,
        undefined
      );
      setAnalysis(result.data);
      setChartData(result.data.time_series || []);
      pnlChartRef.current?.timeScale().fitContent();
      intraChartRef.current?.timeScale().fitContent();

      // Fetch positions for the positions-first list
      setPositionsLoading(true);
      try {
        const positionsRes = await api.positions.listForDeployment(idToFetch);
        setPositions((positionsRes.items || []).map(mapPosition));
      } catch (tErr: any) {
        console.error('Failed to fetch positions:', tErr.message);
        setPositions([]);
      } finally {
        setPositionsLoading(false);
      }
    } catch (err: any) {
      showError(`Failed to fetch analysis: ${err.message}`);
      setAnalysis(null);
      setChartData([]);
      setIntradayData([]);
      setPositions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickTimeRange = (range: '7d' | '30d' | '90d' | 'all') => {
    const now = new Date();
    let start = new Date();
    
    switch (range) {
      case '7d':
        start.setDate(now.getDate() - 7);
        break;
      case '30d':
        start.setDate(now.getDate() - 30);
        break;
      case '90d':
        start.setDate(now.getDate() - 90);
        break;
      case 'all':
        start = new Date(0);
        break;
    }
    
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(now.toISOString().split('T')[0]);
    setStartTime('');
    setEndTime('');
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', { 
        timeZone: timezone === 'UTC' ? 'UTC' : undefined,
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return timestamp;
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100 mb-2">Deployment Analysis</h1>
        <p className="text-slate-400 text-sm">
          Analyze deployment performance with detailed metrics and P&L visualization
        </p>
      </div>

      {/* Input Section */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* Deployment ID Dropdown */}
          <div className="lg:col-span-1">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Deployment
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
              <select
                value={deploymentId}
                onChange={(e) => setDeploymentId(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent appearance-none"
              >
                <option value="">Select deployment</option>
                {deployments.map((dep) => (
                  <option key={dep._id} value={dep._id}>
                    {dep.deployment_name || dep.symbol} ({dep.strategy_mode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Start Time */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Start Time (H:M:S)
            </label>
            <div className="flex gap-1 items-center">
              <select
                value={startHour}
                onChange={(e) => handleStartHourChange(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer text-center"
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-slate-600 font-bold">:</span>
              <select
                value={startMin}
                onChange={(e) => handleStartMinuteChange(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer text-center"
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-slate-600 font-bold">:</span>
              <select
                value={startSec}
                onChange={(e) => handleStartSecondChange(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer text-center"
              >
                {SECOND_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* End Time */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              End Time (H:M:S)
            </label>
            <div className="flex gap-1 items-center">
              <select
                value={endHour}
                onChange={(e) => handleEndHourChange(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer text-center"
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-slate-600 font-bold">:</span>
              <select
                value={endMin}
                onChange={(e) => handleEndMinuteChange(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer text-center"
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-slate-600 font-bold">:</span>
              <select
                value={endSec}
                onChange={(e) => handleEndSecondChange(e.target.value)}
                className="flex-1 min-w-0 px-2 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer text-center"
              >
                {SECOND_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Analyze Button */}
          <div className="flex items-end">
            <button
              onClick={fetchAnalysis}
              disabled={isLoading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 text-white font-semibold rounded-md text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Activity className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Analyze
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Time Range Buttons */}
        <div className="flex gap-2 pt-2">
          <span className="text-xs text-slate-500 self-center mr-2">Quick ranges:</span>
          {(['7d', '30d', '90d', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => handleQuickTimeRange(range)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors"
            >
              {range === 'all' ? 'All Time' : `Last ${range}`}
            </button>
          ))}
        </div>
      </div>

      {/* Results Section */}
      {analysis && (
        <>
          {/* Deployment Info */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-slate-500">Deployment:</span>
                <span className="text-slate-100 ml-2 font-medium">{analysis.deployment_name || analysis.deployment_id}</span>
              </div>
              <div>
                <span className="text-slate-500">Symbol:</span>
                <span className="text-slate-100 ml-2 font-medium">{analysis.symbol}</span>
              </div>
              <div>
                <span className="text-slate-500">Mode:</span>
                <span className="text-slate-100 ml-2 font-medium px-2 py-0.5 bg-slate-800 rounded text-xs">{analysis.strategy_mode}</span>
              </div>
              {analysis.time_range.start && (
                <div>
                  <span className="text-slate-500">From:</span>
                  <span className="text-slate-100 ml-2 font-medium">{formatTimestamp(analysis.time_range.start)}</span>
                </div>
              )}
              {analysis.time_range.end && (
                <div>
                  <span className="text-slate-500">To:</span>
                  <span className="text-slate-100 ml-2 font-medium">{formatTimestamp(analysis.time_range.end)}</span>
                </div>
              )}
            </div>
            {analysis.strategy_mode === "BACKTEST" && (
              <button
                onClick={() => setIsChartOpen(true)}
                className="px-4 py-2 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer self-start sm:self-auto"
              >
                <TrendingUp className="w-4 h-4" />
                View Candlestick Chart
              </button>
            )}
          </div>

          {isLiquiditySweep && (
            <div className="flex gap-2 border-b border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setAnalysisPanel('performance')}
                className={`px-3 py-1.5 rounded text-xs font-medium ${analysisPanel === 'performance' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                Performance
              </button>
              <button
                type="button"
                onClick={() => setAnalysisPanel('sweepSignals')}
                className={`px-3 py-1.5 rounded text-xs font-medium ${analysisPanel === 'sweepSignals' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                Sweep Signals
              </button>
            </div>
          )}

          {isLiquiditySweep && analysisPanel === 'sweepSignals' && deploymentId && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg">
              <SweepSignalLogView deploymentId={deploymentId} />
            </div>
          )}

          {(!isLiquiditySweep || analysisPanel === 'performance') && (
          <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Trades */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center">
                  <Activity className="w-5 h-5 text-indigo-400" />
                </div>
              </div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Total Trades</p>
              <p className="text-2xl font-bold text-slate-100">{analysis.metrics.total_trades}</p>
              <div className="mt-2 flex gap-2 text-xs">
                <span className="text-emerald-400">{analysis.metrics.wins} Wins</span>
                <span className="text-rose-400">{analysis.metrics.losses} Losses</span>
              </div>
            </div>

            {/* Total P&L */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  analysis.metrics.total_pnl >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                }`}>
                  <DollarSign className={`w-5 h-5 ${
                    analysis.metrics.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`} />
                </div>
              </div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Total P&L</p>
              <p className={`text-2xl font-bold ${
                analysis.metrics.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {formatCurrency(analysis.metrics.total_pnl)}
              </p>
            </div>

            {/* Profitability Factor */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-amber-400" />
                </div>
              </div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Profitability Factor</p>
              <p className="text-2xl font-bold text-slate-100">
                {typeof analysis.metrics.profitability_factor === 'number' 
                  ? analysis.metrics.profitability_factor.toFixed(2)
                  : analysis.metrics.profitability_factor
                }
              </p>
              <p className="text-slate-500 text-xs mt-1">
                Win Rate: {analysis.metrics.win_rate}
              </p>
            </div>

            {/* Max Drawdown/Drawup */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-rose-500/10 rounded-lg flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-rose-400" />
                </div>
              </div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Max Drawdown</p>
              <p className="text-2xl font-bold text-rose-400">
                {formatCurrency(analysis.metrics.max_drawdown)}
              </p>
              <div className="mt-2 flex items-center gap-1 text-xs">
                <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Max Drawup: {formatCurrency(analysis.metrics.max_drawup)}</span>
              </div>
            </div>
          </div>

          {/* Additional Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gross Profit */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <ArrowUpRight className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Gross Profit</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">
                {formatCurrency(analysis.metrics.gross_profit)}
              </p>
            </div>

            {/* Gross Loss */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-rose-500/10 rounded-lg flex items-center justify-center">
                  <ArrowDownRight className="w-5 h-5 text-rose-400" />
                </div>
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Gross Loss</span>
              </div>
              <p className="text-2xl font-bold text-rose-400">
                {formatCurrency(analysis.metrics.gross_loss)}
              </p>
            </div>
          </div>

          {/* P&L Chart */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
            <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
              <h3 className="text-lg font-bold text-slate-100 mb-0 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-400" />
                Profit & Loss Over Time
              </h3>
            </div>
            
            <div className="relative bg-[#0f172a] rounded-lg border border-slate-800 overflow-hidden min-h-[380px]">
              {pnlSeriesData.length === 0 && (
                <div className="absolute inset-0 bg-[#0f172a] z-10 flex items-center justify-center text-slate-500 text-sm">
                  No trade data available for the selected period
                </div>
              )}
              <div ref={pnlChartContainerRef} className="w-full h-[380px]" />
            </div>
          </div>

          {/* Intraday Trade Distribution Chart */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
            <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
              <h3 className="text-lg font-bold text-slate-100 mb-0 flex items-center gap-2">
                <Clock className="w-5 h-5 text-cyan-400" />
                Intraday Trade Distribution ({timezone === 'UTC' ? 'UTC' : 'Local'})
              </h3>
            </div>
            
            <p className="text-slate-400 text-xs mb-4">
              Shows individual trades spread across the day (00:00 - 23:59). Zoom and pan to explore. Chart auto-zooms to the most active trading hours on load.
            </p>
            
            <div className="relative bg-[#0f172a] rounded-lg border border-slate-800 overflow-hidden min-h-[380px]">
              {intradaySeriesData.length === 0 && (
                <div className="absolute inset-0 bg-[#0f172a] z-10 flex items-center justify-center text-slate-500 text-sm">
                  No intraday trade data available
                </div>
              )}
              <div ref={intraChartContainerRef} className="w-full h-[380px]" />
            </div>
          </div>

          {/* ===== Positions List ===== */}
          <PositionsList
            positions={positions}
            positionsLoading={positionsLoading}
            timezone={timezone}
            expandedPositions={expandedPositions}
            setExpandedPositions={setExpandedPositions}
            formatCurrency={formatCurrency}
            onSelectTransaction={onSelectTransaction}
          />
          </>
          )}
        </>
      )}

      {/* Empty State */}
      {!analysis && !isLoading && (
        <div className="text-center py-16">
          <Activity className="w-16 h-16 text-slate-700 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-400 mb-2">No Analysis Data</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Select a deployment from the dropdown and click "Analyze" to view performance metrics and P&L visualization
          </p>
        </div>
      )}

      {analysis && (
        <CandlestickSidebar
          deploymentId={deploymentId}
          symbol={analysis.symbol}
          date={analysis.time_range.start ? analysis.time_range.start.slice(0, 10) : ''}
          isOpen={isChartOpen}
          onClose={() => setIsChartOpen(false)}
        />
      )}
    </div>
  );
}

