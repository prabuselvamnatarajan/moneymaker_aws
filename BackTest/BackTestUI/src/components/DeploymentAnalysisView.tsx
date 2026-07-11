/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ScatterChart, Scatter, ZAxis, ReferenceArea } from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, ArrowUpRight, ArrowDownRight, Calendar, Search, Clock } from 'lucide-react';
import { DeploymentAnalysis, TimeSeriesDataPoint, IntradayTradeDataPoint, Deployment } from '../types';
import { api } from '../api';
import { useToast } from './Toast';

const RefArea = ReferenceArea as any;

interface DeploymentAnalysisViewProps {
  selectedDeploymentId: string | null;
  timezone?: string;
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

export default function DeploymentAnalysisView({ selectedDeploymentId, timezone = 'UTC' }: DeploymentAnalysisViewProps) {
  const { showError } = useToast();
  
  const [deploymentId, setDeploymentId] = useState<string>('');
  
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

  // Zooming states and handlers
  const [pnlZoomMode, setPnLZoomMode] = useState<'x' | 'y' | 'both'>('x');
  const [pnlZoomX, setPnLZoomX] = useState<[number, number] | null>(null);
  const [pnlZoomY, setPnLZoomY] = useState<[number, number] | null>(null);
  const [pnlRefAreaLeft, setPnLRefAreaLeft] = useState<number | undefined>(undefined);
  const [pnlRefAreaRight, setPnLRefAreaRight] = useState<number | undefined>(undefined);
  const [pnlRefAreaTop, setPnLRefAreaTop] = useState<number | undefined>(undefined);
  const [pnlRefAreaBottom, setPnLRefAreaBottom] = useState<number | undefined>(undefined);

  const [intraZoomMode, setIntraZoomMode] = useState<'x' | 'y' | 'both'>('x');
  const [intraZoomX, setIntraZoomX] = useState<[number, number] | null>(null);
  const [intraZoomY, setIntraZoomY] = useState<[number, number] | null>(null);
  const [intraRefAreaLeft, setIntraRefAreaLeft] = useState<number | undefined>(undefined);
  const [intraRefAreaRight, setIntraRefAreaRight] = useState<number | undefined>(undefined);
  const [intraRefAreaTop, setIntraRefAreaTop] = useState<number | undefined>(undefined);
  const [intraRefAreaBottom, setIntraRefAreaBottom] = useState<number | undefined>(undefined);

  const isPnLZoomed = pnlZoomX !== null || pnlZoomY !== null;
  const isIntraZoomed = intraZoomX !== null || intraZoomY !== null;

  const handlePnLResetZoom = () => {
    setPnLZoomX(null);
    setPnLZoomY(null);
    setPnLRefAreaLeft(undefined);
    setPnLRefAreaRight(undefined);
    setPnLRefAreaTop(undefined);
    setPnLRefAreaBottom(undefined);
  };

  const handleIntraResetZoom = () => {
    setIntraZoomX(null);
    setIntraZoomY(null);
    setIntraRefAreaLeft(undefined);
    setIntraRefAreaRight(undefined);
    setIntraRefAreaTop(undefined);
    setIntraRefAreaBottom(undefined);
  };

  const processedChartData = chartData.map((d, index) => ({
    ...d,
    index,
  }));

  const pnlXDomain = pnlZoomX || [0, Math.max(0, processedChartData.length - 1)];
  const pnlYDomain = pnlZoomY || ['auto', 'auto'];

  const scatterXDomain = intraZoomX || defaultDomain;
  const scatterYDomain = intraZoomY || [0, 59];

  const handlePnLMouseDown = (e: any) => {
    if (!e) return;
    const xVal = e.activeLabel !== undefined ? Number(e.activeLabel) : undefined;
    const yVal = e.activePayload && e.activePayload[0]?.value !== undefined 
      ? Number(e.activePayload[0].value) 
      : undefined;
    setPnLRefAreaLeft(xVal);
    setPnLRefAreaBottom(yVal);
  };

  const handlePnLMouseMove = (e: any) => {
    if (pnlRefAreaLeft === undefined) return;
    if (!e) return;
    const xVal = e.activeLabel !== undefined ? Number(e.activeLabel) : undefined;
    const yVal = e.activePayload && e.activePayload[0]?.value !== undefined 
      ? Number(e.activePayload[0].value) 
      : undefined;
    setPnLRefAreaRight(xVal);
    setPnLRefAreaTop(yVal);
  };

  const handlePnLMouseUp = () => {
    if (pnlRefAreaLeft === undefined || pnlRefAreaRight === undefined) {
      setPnLRefAreaLeft(undefined);
      setPnLRefAreaRight(undefined);
      setPnLRefAreaTop(undefined);
      setPnLRefAreaBottom(undefined);
      return;
    }

    let left = pnlRefAreaLeft;
    let right = pnlRefAreaRight;
    if (left > right) {
      [left, right] = [right, left];
    }

    let bottom = pnlRefAreaBottom;
    let top = pnlRefAreaTop;
    if (bottom !== undefined && top !== undefined && bottom > top) {
      [bottom, top] = [top, bottom];
    }

    if (pnlZoomMode === 'x' || pnlZoomMode === 'both') {
      if (left !== right) {
        setPnLZoomX([left, right]);
      }
    }
    if (pnlZoomMode === 'y' || pnlZoomMode === 'both') {
      if (bottom !== undefined && top !== undefined && bottom !== top) {
        setPnLZoomY([bottom, top]);
      }
    }

    setPnLRefAreaLeft(undefined);
    setPnLRefAreaRight(undefined);
    setPnLRefAreaTop(undefined);
    setPnLRefAreaBottom(undefined);
  };

  const handleIntraMouseDown = (e: any) => {
    if (!e || !e.activePayload || e.activePayload.length === 0) return;
    const hourVal = Number(e.activePayload[0].payload.hour);
    const minuteVal = Number(e.activePayload[0].payload.minute);
    setIntraRefAreaLeft(hourVal);
    setIntraRefAreaBottom(minuteVal);
  };

  const handleIntraMouseMove = (e: any) => {
    if (intraRefAreaLeft === undefined) return;
    if (!e || !e.activePayload || e.activePayload.length === 0) return;
    const hourVal = Number(e.activePayload[0].payload.hour);
    const minuteVal = Number(e.activePayload[0].payload.minute);
    setIntraRefAreaRight(hourVal);
    setIntraRefAreaTop(minuteVal);
  };

  const handleIntraMouseUp = () => {
    if (intraRefAreaLeft === undefined || intraRefAreaRight === undefined) {
      setIntraRefAreaLeft(undefined);
      setIntraRefAreaRight(undefined);
      setIntraRefAreaTop(undefined);
      setIntraRefAreaBottom(undefined);
      return;
    }

    let left = intraRefAreaLeft;
    let right = intraRefAreaRight;
    if (left > right) {
      [left, right] = [right, left];
    }

    let bottom = intraRefAreaBottom;
    let top = intraRefAreaTop;
    if (bottom !== undefined && top !== undefined && bottom > top) {
      [bottom, top] = [top, bottom];
    }

    if (intraZoomMode === 'x' || intraZoomMode === 'both') {
      if (left !== right) {
        setIntraZoomX([left, right]);
      }
    }
    if (intraZoomMode === 'y' || intraZoomMode === 'both') {
      if (bottom !== undefined && top !== undefined && bottom !== top) {
        setIntraZoomY([bottom, top]);
      }
    }

    setIntraRefAreaLeft(undefined);
    setIntraRefAreaRight(undefined);
    setIntraRefAreaTop(undefined);
    setIntraRefAreaBottom(undefined);
  };

  const zoomInPnLX = () => {
    const currentDomain = pnlZoomX || [0, Math.max(0, processedChartData.length - 1)];
    const range = currentDomain[1] - currentDomain[0];
    if (range <= 2) return;
    const offset = Math.max(1, Math.round(range * 0.1));
    setPnLZoomX([currentDomain[0] + offset, currentDomain[1] - offset]);
  };

  const zoomOutPnLX = () => {
    const currentDomain = pnlZoomX || [0, Math.max(0, processedChartData.length - 1)];
    const range = currentDomain[1] - currentDomain[0];
    const offset = Math.max(1, Math.round(range * 0.1));
    const newStart = Math.max(0, currentDomain[0] - offset);
    const newEnd = Math.min(Math.max(0, processedChartData.length - 1), currentDomain[1] + offset);
    setPnLZoomX([newStart, newEnd]);
  };

  const zoomInPnLY = () => {
    const pnlValues = processedChartData.map(d => d.pnl);
    const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
    const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
    const currentDomain = pnlZoomY || [minVal, maxVal];
    const range = Number(currentDomain[1]) - Number(currentDomain[0]);
    const offset = range * 0.1;
    setPnLZoomY([Number(currentDomain[0]) + offset, Number(currentDomain[1]) - offset]);
  };

  const zoomOutPnLY = () => {
    const pnlValues = processedChartData.map(d => d.pnl);
    const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
    const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
    const currentDomain = pnlZoomY || [minVal, maxVal];
    const range = Number(currentDomain[1]) - Number(currentDomain[0]);
    const offset = range * 0.1;
    setPnLZoomY([Number(currentDomain[0]) - offset, Number(currentDomain[1]) + offset]);
  };

  const zoomInIntraX = () => {
    const currentDomain = intraZoomX || defaultDomain;
    const range = currentDomain[1] - currentDomain[0];
    if (range <= 1) return;
    const offset = range * 0.1;
    setIntraZoomX([currentDomain[0] + offset, currentDomain[1] - offset]);
  };

  const zoomOutIntraX = () => {
    const currentDomain = intraZoomX || defaultDomain;
    const range = currentDomain[1] - currentDomain[0];
    const offset = range * 0.1;
    const newStart = Math.max(0, currentDomain[0] - offset);
    const newEnd = Math.min(24, currentDomain[1] + offset);
    setIntraZoomX([newStart, newEnd]);
  };

  const zoomInIntraY = () => {
    const currentDomain = intraZoomY || [0, 59];
    const range = currentDomain[1] - currentDomain[0];
    if (range <= 5) return;
    const offset = Math.max(1, Math.round(range * 0.1));
    setIntraZoomY([currentDomain[0] + offset, currentDomain[1] - offset]);
  };

  const zoomOutIntraY = () => {
    const currentDomain = intraZoomY || [0, 59];
    const range = currentDomain[1] - currentDomain[0];
    const offset = Math.max(1, Math.round(range * 0.1));
    const newStart = Math.max(0, currentDomain[0] - offset);
    const newEnd = Math.min(59, currentDomain[1] + offset);
    setIntraZoomY([newStart, newEnd]);
  };

  useEffect(() => {
    if (selectedDeploymentId) {
      setDeploymentId(selectedDeploymentId);
    }
  }, [selectedDeploymentId]);

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
      handlePnLResetZoom();
      handleIntraResetZoom();
    } catch (err: any) {
      showError(`Failed to fetch analysis: ${err.message}`);
      setAnalysis(null);
      setChartData([]);
      setIntradayData([]);
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
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
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
          </div>

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
              <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800 text-xs">
                <div className="flex items-center gap-1 border-r border-slate-800 pr-2">
                  <span className="text-slate-500 font-mono select-none">Mode:</span>
                  {(['x', 'y', 'both'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setPnLZoomMode(mode)}
                      className={`px-2 py-0.5 rounded transition-all cursor-pointer font-medium font-sans uppercase text-[10px] ${
                        pnlZoomMode === mode ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode === 'both' ? 'X & Y' : `${mode}-axis`}
                    </button>
                  ))}
                </div>
                
                <div className="flex items-center gap-1 border-r border-slate-800 pr-2">
                  <span className="text-slate-500 font-mono select-none mr-1">X-Zoom:</span>
                  <button
                    onClick={zoomInPnLX}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom In X"
                  >
                    +
                  </button>
                  <button
                    onClick={zoomOutPnLX}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom Out X"
                  >
                    -
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-slate-500 font-mono select-none mr-1">Y-Zoom:</span>
                  <button
                    onClick={zoomInPnLY}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom In Y"
                  >
                    +
                  </button>
                  <button
                    onClick={zoomOutPnLY}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom Out Y"
                  >
                    -
                  </button>
                </div>

                {isPnLZoomed && (
                  <button
                    onClick={handlePnLResetZoom}
                    className="ml-2 px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded text-[10px] uppercase transition-all cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="h-[400px] select-none">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={processedChartData}
                    onMouseDown={handlePnLMouseDown}
                    onMouseMove={handlePnLMouseMove}
                    onMouseUp={handlePnLMouseUp}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      type="number"
                      dataKey="index" 
                      domain={pnlXDomain}
                      allowDataOverflow={true}
                      tickFormatter={(idx) => {
                        const point = processedChartData[idx];
                        return point ? formatTimestamp(point.timestamp) : '';
                      }}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis 
                      domain={pnlYDomain}
                      allowDataOverflow={true}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `₹${value}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#f1f5f9',
                      }}
                      labelFormatter={(idx) => {
                        const point = processedChartData[idx];
                        return point ? formatTimestamp(point.timestamp) : '';
                      }}
                      formatter={(value: number) => [formatCurrency(value), 'Cumulative P&L']}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                    <Line
                      type="monotone"
                      dataKey="pnl"
                      name="P&L"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6, fill: '#6366f1' }}
                    />
                    {pnlRefAreaLeft !== undefined && pnlRefAreaRight !== undefined ? (
                      <RefArea
                        x1={pnlRefAreaLeft}
                        x2={pnlRefAreaRight}
                        y1={pnlZoomMode === 'y' || pnlZoomMode === 'both' ? pnlRefAreaBottom : undefined}
                        y2={pnlZoomMode === 'y' || pnlZoomMode === 'both' ? pnlRefAreaTop : undefined}
                        fill="#6366f1"
                        fillOpacity={0.15}
                      />
                    ) : null}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">
                  No trade data available for the selected period
                </div>
              )}
            </div>
          </div>

          {/* Intraday Trade Distribution Chart */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
            <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
              <h3 className="text-lg font-bold text-slate-100 mb-0 flex items-center gap-2">
                <Clock className="w-5 h-5 text-cyan-400" />
                Intraday Trade Distribution ({timezone === 'UTC' ? 'UTC' : 'Local'})
              </h3>
              <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800 text-xs">
                <div className="flex items-center gap-1 border-r border-slate-800 pr-2">
                  <span className="text-slate-500 font-mono select-none">Mode:</span>
                  {(['x', 'y', 'both'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setIntraZoomMode(mode)}
                      className={`px-2.5 py-0.5 rounded transition-all cursor-pointer font-medium font-sans uppercase text-[10px] ${
                        intraZoomMode === mode ? 'bg-cyan-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode === 'both' ? 'X & Y' : `${mode}-axis`}
                    </button>
                  ))}
                </div>
                
                <div className="flex items-center gap-1 border-r border-slate-800 pr-2">
                  <span className="text-slate-500 font-mono select-none mr-1">X-Zoom:</span>
                  <button
                    onClick={zoomInIntraX}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom In X"
                  >
                    +
                  </button>
                  <button
                    onClick={zoomOutIntraX}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom Out X"
                  >
                    -
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-slate-500 font-mono select-none mr-1">Y-Zoom:</span>
                  <button
                    onClick={zoomInIntraY}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom In Y"
                  >
                    +
                  </button>
                  <button
                    onClick={zoomOutIntraY}
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer font-bold w-5 h-5 flex items-center justify-center"
                    title="Zoom Out Y"
                  >
                    -
                  </button>
                </div>

                {isIntraZoomed && (
                  <button
                    onClick={handleIntraResetZoom}
                    className="ml-2 px-2.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded text-[10px] uppercase transition-all cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <p className="text-slate-400 text-xs mb-4">
              Shows individual trades spread across the day (00:00 - 23:59). Zoom and pan to explore. Chart auto-zooms to the most active trading hours on load.
            </p>
            <div className="h-[400px] select-none">
              {intradayData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                    onMouseDown={handleIntraMouseDown}
                    onMouseMove={handleIntraMouseMove}
                    onMouseUp={handleIntraMouseUp}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      type="number"
                      dataKey="hour"
                      name="Hour"
                      domain={scatterXDomain}
                      allowDataOverflow={true}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `${String(Math.floor(value)).padStart(2, '0')}:00`}
                      label={{ value: 'Time of Day (Hours)', position: 'insideBottom', offset: -10, fill: '#94a3b8', fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="minute"
                      name="Minute"
                      domain={scatterYDomain}
                      allowDataOverflow={true}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => String(value).padStart(2, '0')}
                      label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }}
                    />
                    <ZAxis type="number" dataKey="pnl" range={[50, 200]} name="P&L" />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#f1f5f9',
                      }}
                      labelFormatter={(label) => `Hour: ${String(Math.floor(label)).padStart(2, '0')}`}
                      formatter={(value: any, name: string, props: any) => {
                        const payload = props?.payload;
                        if (payload) {
                          return [
                            `${String(payload.hour).padStart(2, '0')}:${String(payload.minute).padStart(2, '0')}:${String(payload.second).padStart(2, '0')}`,
                            'Time'
                          ];
                        }
                        return [value, name];
                      }}
                    />
                    <Legend />
                    <ReferenceLine x={0} stroke="#64748b" strokeDasharray="3 3" />
                    <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                    <Scatter
                      name="Trades"
                      data={intradayData}
                      fill="#06b6d4"
                      shape="circle"
                    />
                    {intraRefAreaLeft !== undefined && intraRefAreaRight !== undefined ? (
                      <RefArea
                        x1={intraRefAreaLeft}
                        x2={intraRefAreaRight}
                        y1={intraZoomMode === 'y' || intraZoomMode === 'both' ? intraRefAreaBottom : undefined}
                        y2={intraZoomMode === 'y' || intraZoomMode === 'both' ? intraRefAreaTop : undefined}
                        fill="#22d3ee"
                        fillOpacity={0.15}
                      />
                    ) : null}
                  </ScatterChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">
                  No intraday trade data available
                </div>
              )}
            </div>
          </div>
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
    </div>
  );
}
