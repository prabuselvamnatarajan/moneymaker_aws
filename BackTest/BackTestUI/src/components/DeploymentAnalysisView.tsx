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
  const pnlContainerRef = useRef<HTMLDivElement>(null);
  const intraContainerRef = useRef<HTMLDivElement>(null);

  const [pnlZoomX, setPnLZoomX] = useState<[number, number] | null>(null);
  const [pnlZoomY, setPnLZoomY] = useState<[number, number] | null>(null);

  const [intraZoomX, setIntraZoomX] = useState<[number, number] | null>(null);
  const [intraZoomY, setIntraZoomY] = useState<[number, number] | null>(null);

  const isPnLZoomed = pnlZoomX !== null || pnlZoomY !== null;
  const isIntraZoomed = intraZoomX !== null || intraZoomY !== null;

  const handlePnLResetZoom = () => {
    setPnLZoomX(null);
    setPnLZoomY(null);
    setPnLDragState(null);
    setPnLTouchState(null);
  };

  const handleIntraResetZoom = () => {
    setIntraZoomX(null);
    setIntraZoomY(null);
    setIntraDragState(null);
    setIntraTouchState(null);
  };

  const processedChartData = chartData.map((d, index) => ({
    ...d,
    index,
  }));

  // Nice ticks and domains for P&L Chart
  const pnlXMin = pnlZoomX ? pnlZoomX[0] : 0;
  const pnlXMax = pnlZoomX ? pnlZoomX[1] : Math.max(1, processedChartData.length - 1);
  const pnlXTicks = getNiceTicks(pnlXMin, pnlXMax, 6);
  const pnlXDomainCalculated: [number, number] = pnlXTicks.length >= 2
    ? [pnlXTicks[0], pnlXTicks[pnlXTicks.length - 1]]
    : [pnlXMin, pnlXMax];

  const pnlValues = processedChartData.map(d => d.pnl);
  const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
  const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
  
  const currentYMin = pnlZoomY ? pnlZoomY[0] : minVal;
  const currentYMax = pnlZoomY ? pnlZoomY[1] : maxVal;
  const safeYMin = currentYMin === currentYMax ? currentYMin - 100 : currentYMin;
  const safeYMax = currentYMin === currentYMax ? currentYMax + 100 : currentYMax;
  
  const pnlYTicks = getNiceTicks(safeYMin, safeYMax, 6);
  const pnlYDomainCalculated: [number, number] = pnlYTicks.length >= 2 
    ? [pnlYTicks[0], pnlYTicks[pnlYTicks.length - 1]]
    : [safeYMin, safeYMax];

  // Nice ticks and domains for Scatter Chart
  const scatterXDomain = intraZoomX || defaultDomain;
  const scatterYDomain = intraZoomY || [0, 59];

  const scatterXTicks = getNiceTicks(scatterXDomain[0], scatterXDomain[1], 6);
  const scatterYTicks = getNiceTicks(scatterYDomain[0], scatterYDomain[1], 6);

  const scatterXDomainCalculated: [number, number] = scatterXTicks.length >= 2
    ? [scatterXTicks[0], scatterXTicks[scatterXTicks.length - 1]]
    : [scatterXDomain[0], scatterXDomain[1]];

  const scatterYDomainCalculated: [number, number] = scatterYTicks.length >= 2
    ? [scatterYTicks[0], scatterYTicks[scatterYTicks.length - 1]]
    : [scatterYDomain[0], scatterYDomain[1]];

  // Helper to zoom X-axis around a target center index/hour
  const zoomXAxis = (
    isPnL: boolean,
    factor: number,
    centerIndexOrHour?: number
  ) => {
    if (isPnL) {
      const dataLen = processedChartData.length;
      if (dataLen <= 1) return;
      const current = pnlZoomX || [0, dataLen - 1];
      const range = current[1] - current[0];
      const center = centerIndexOrHour !== undefined && !isNaN(centerIndexOrHour) 
        ? centerIndexOrHour 
        : (current[0] + current[1]) / 2;
      const newRange = Math.max(2, range * factor);
      
      const leftRatio = (center - current[0]) / (range || 1);
      let newStart = center - newRange * leftRatio;
      let newEnd = newStart + newRange;
      
      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(dataLen - 1, newRange);
      }
      if (newEnd > dataLen - 1) {
        newEnd = dataLen - 1;
        newStart = Math.max(0, newEnd - newRange);
      }
      
      if (!isNaN(newStart) && !isNaN(newEnd) && isFinite(newStart) && isFinite(newEnd) && newStart < newEnd) {
        setPnLZoomX([newStart, newEnd]);
      }
    } else {
      const current = intraZoomX || defaultDomain;
      const range = current[1] - current[0];
      const center = centerIndexOrHour !== undefined && !isNaN(centerIndexOrHour) 
        ? centerIndexOrHour 
        : (current[0] + current[1]) / 2;
      const newRange = Math.max(1, range * factor);
      
      const leftRatio = (center - current[0]) / (range || 1);
      let newStart = center - newRange * leftRatio;
      let newEnd = newStart + newRange;
      
      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(24, newRange);
      }
      if (newEnd > 24) {
        newEnd = 24;
        newStart = Math.max(0, newEnd - newRange);
      }
      
      if (!isNaN(newStart) && !isNaN(newEnd) && isFinite(newStart) && isFinite(newEnd) && newStart < newEnd) {
        setIntraZoomX([newStart, newEnd]);
      }
    }
  };

  // Helper to zoom Y-axis around a target center value
  const zoomYAxis = (
    isPnL: boolean,
    factor: number,
    centerVal?: number
  ) => {
    if (isPnL) {
      const pnlValues = processedChartData.map(d => d.pnl);
      const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
      const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
      const current = pnlZoomY || [minVal, maxVal];
      let range = Number(current[1]) - Number(current[0]);
      if (isNaN(range) || !isFinite(range) || range <= 0) {
        range = 100;
      }
      const center = centerVal !== undefined && !isNaN(centerVal) 
        ? centerVal 
        : (Number(current[0]) + Number(current[1])) / 2;
      const newRange = range * factor;
      
      const bottomRatio = (center - Number(current[0])) / (range || 1);
      let newStart = center - newRange * bottomRatio;
      let newEnd = newStart + newRange;
      
      if (!isNaN(newStart) && !isNaN(newEnd) && isFinite(newStart) && isFinite(newEnd) && newStart < newEnd) {
        setPnLZoomY([newStart, newEnd]);
      }
    } else {
      const current = intraZoomY || [0, 59];
      const range = current[1] - current[0];
      const center = centerVal !== undefined && !isNaN(centerVal) 
        ? centerVal 
        : (current[0] + current[1]) / 2;
      const newRange = Math.max(5, range * factor);
      
      const bottomRatio = (center - current[0]) / (range || 1);
      let newStart = center - newRange * bottomRatio;
      let newEnd = newStart + newRange;
      
      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(59, newRange);
      }
      if (newEnd > 59) {
        newEnd = 59;
        newStart = Math.max(0, newEnd - newRange);
      }
      
      if (!isNaN(newStart) && !isNaN(newEnd) && isFinite(newStart) && isFinite(newEnd) && newStart < newEnd) {
        setIntraZoomY([newStart, newEnd]);
      }
    }
  };

  // Scroll wheel zooming
  useEffect(() => {
    const pnlEl = pnlContainerRef.current;
    if (!pnlEl) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = pnlEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // XAxis is at the bottom (y > 330), YAxis is on the left (x < 65)
      const isYAxisZone = x < 65;
      const isXAxisZone = y > 330;
      
      // Fine-grained delta-based zoom speed
      const rawDelta = e.deltaY;
      const normalizedDelta = Math.min(Math.max(rawDelta, -100), 100) / 100;
      
      // Scroll up (deltaY < 0): zoom out -> factor > 1
      // Scroll down (deltaY > 0): zoom in -> factor < 1
      const intensity = 0.04; // 4% zoom per tick
      const factor = 1 - normalizedDelta * intensity;
      
      // Calculate mouse value positions
      const gridLeft = 65;
      const gridRight = rect.width - 20;
      const gridTop = 20;
      const gridBottom = rect.height - 60;
      const gridWidth = gridRight - gridLeft;
      const gridHeight = gridBottom - gridTop;
      
      const pctX = Math.min(Math.max((x - gridLeft) / gridWidth, 0), 1);
      const pctY = Math.min(Math.max((gridBottom - y) / gridHeight, 0), 1);
      
      const currentX = pnlZoomX || [0, Math.max(1, processedChartData.length - 1)];
      const pnlValues = processedChartData.map(d => d.pnl);
      const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
      const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
      const currentY = pnlZoomY || [minVal, maxVal];
      
      const mouseValX = currentX[0] + pctX * (currentX[1] - currentX[0]);
      const mouseValY = currentY[0] + pctY * (currentY[1] - currentY[0]);
      
      if (isYAxisZone) {
        zoomYAxis(true, factor, mouseValY);
      } else if (isXAxisZone) {
        zoomXAxis(true, factor, mouseValX);
      } else {
        zoomXAxis(true, factor, mouseValX);
        zoomYAxis(true, factor, mouseValY);
      }
    };

    pnlEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      pnlEl.removeEventListener('wheel', handleWheel);
    };
  }, [processedChartData, pnlZoomX, pnlZoomY]);

  useEffect(() => {
    const intraEl = intraContainerRef.current;
    if (!intraEl) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = intraEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const isYAxisZone = x < 65;
      const isXAxisZone = y > 330;
      
      const rawDelta = e.deltaY;
      const normalizedDelta = Math.min(Math.max(rawDelta, -100), 100) / 100;
      const intensity = 0.04;
      const factor = 1 - normalizedDelta * intensity;
      
      const gridLeft = 65;
      const gridRight = rect.width - 20;
      const gridTop = 20;
      const gridBottom = rect.height - 60;
      const gridWidth = gridRight - gridLeft;
      const gridHeight = gridBottom - gridTop;
      
      const pctX = Math.min(Math.max((x - gridLeft) / gridWidth, 0), 1);
      const pctY = Math.min(Math.max((gridBottom - y) / gridHeight, 0), 1);
      
      const currentX = intraZoomX || defaultDomain;
      const currentY = intraZoomY || [0, 59];
      
      const mouseValX = currentX[0] + pctX * (currentX[1] - currentX[0]);
      const mouseValY = currentY[0] + pctY * (currentY[1] - currentY[0]);
      
      if (isYAxisZone) {
        zoomYAxis(false, factor, mouseValY);
      } else if (isXAxisZone) {
        zoomXAxis(false, factor, mouseValX);
      } else {
        zoomXAxis(false, factor, mouseValX);
        zoomYAxis(false, factor, mouseValY);
      }
    };

    intraEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      intraEl.removeEventListener('wheel', handleWheel);
    };
  }, [intradayData, intraZoomX, intraZoomY, defaultDomain]);

  // Drag Panning States & Handlers
  const [pnlDragState, setPnLDragState] = useState<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startDomainX: [number, number];
    startDomainY: [number, number];
  } | null>(null);

  const [intraDragState, setIntraDragState] = useState<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startDomainX: [number, number];
    startDomainY: [number, number];
  } | null>(null);

  const handlePnLMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = pnlContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    const currentX = pnlZoomX || [0, Math.max(0, processedChartData.length - 1)];
    const pnlValues = processedChartData.map(d => d.pnl);
    const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
    const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
    const currentY = pnlZoomY || [minVal, maxVal];
    
    setPnLDragState({
      isDragging: true,
      startX: clientX,
      startY: clientY,
      startDomainX: [currentX[0], currentX[1]],
      startDomainY: [Number(currentY[0]), Number(currentY[1])],
    });
  };

  const handlePnLMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pnlDragState || !pnlDragState.isDragging) return;
    
    const rect = pnlContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const dx = e.clientX - pnlDragState.startX;
    const dy = e.clientY - pnlDragState.startY;
    
    const gridWidth = rect.width - 85;
    const gridHeight = rect.height - 80;
    
    const xRange = pnlDragState.startDomainX[1] - pnlDragState.startDomainX[0];
    const yRange = pnlDragState.startDomainY[1] - pnlDragState.startDomainY[0];
    
    const shiftX = -dx * (xRange / gridWidth);
    const shiftY = dy * (yRange / gridHeight);
    
    const dataLen = processedChartData.length;
    let newStartX = pnlDragState.startDomainX[0] + shiftX;
    let newEndX = pnlDragState.startDomainX[1] + shiftX;
    
    if (newStartX < 0) {
      newEndX -= newStartX;
      newStartX = 0;
    }
    if (newEndX > dataLen - 1) {
      newStartX -= (newEndX - (dataLen - 1));
      newEndX = dataLen - 1;
    }
    
    if (!isNaN(newStartX) && !isNaN(newEndX) && isFinite(newStartX) && isFinite(newEndX) && newStartX < newEndX) {
      setPnLZoomX([newStartX, newEndX]);
    }
    
    const newStartY = pnlDragState.startDomainY[0] + shiftY;
    const newEndY = pnlDragState.startDomainY[1] + shiftY;
    if (!isNaN(newStartY) && !isNaN(newEndY) && isFinite(newStartY) && isFinite(newEndY) && newStartY < newEndY) {
      setPnLZoomY([newStartY, newEndY]);
    }
  };

  const handlePnLMouseUp = () => {
    setPnLDragState(null);
  };

  const handleIntraMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = intraContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    const currentX = intraZoomX || defaultDomain;
    const currentY = intraZoomY || [0, 59];
    
    setIntraDragState({
      isDragging: true,
      startX: clientX,
      startY: clientY,
      startDomainX: [currentX[0], currentX[1]],
      startDomainY: [currentY[0], currentY[1]],
    });
  };

  const handleIntraMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!intraDragState || !intraDragState.isDragging) return;
    
    const rect = intraContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const dx = e.clientX - intraDragState.startX;
    const dy = e.clientY - intraDragState.startY;
    
    const gridWidth = rect.width - 85;
    const gridHeight = rect.height - 80;
    
    const xRange = intraDragState.startDomainX[1] - intraDragState.startDomainX[0];
    const yRange = intraDragState.startDomainY[1] - intraDragState.startDomainY[0];
    
    const shiftX = -dx * (xRange / gridWidth);
    const shiftY = dy * (yRange / gridHeight);
    
    let newStartX = intraDragState.startDomainX[0] + shiftX;
    let newEndX = intraDragState.startDomainX[1] + shiftX;
    
    if (newStartX < 0) {
      newEndX -= newStartX;
      newStartX = 0;
    }
    if (newEndX > 24) {
      newStartX -= (newEndX - 24);
      newEndX = 24;
    }
    
    let newStartY = intraDragState.startDomainY[0] + shiftY;
    let newEndY = intraDragState.startDomainY[1] + shiftY;
    
    if (newStartY < 0) {
      newEndY -= newStartY;
      newStartY = 0;
    }
    if (newEndY > 59) {
      newStartY -= (newEndY - 59);
      newEndY = 59;
    }
    
    if (!isNaN(newStartX) && !isNaN(newEndX) && isFinite(newStartX) && isFinite(newEndX) && newStartX < newEndX) {
      setIntraZoomX([newStartX, newEndX]);
    }
    if (!isNaN(newStartY) && !isNaN(newEndY) && isFinite(newStartY) && isFinite(newEndY) && newStartY < newEndY) {
      setIntraZoomY([newStartY, newEndY]);
    }
  };

  const handleIntraMouseUp = () => {
    setIntraDragState(null);
  };

  // Touch zoom state and handlers (two finger zoom)
  const [pnlTouchState, setPnLTouchState] = useState<{
    startDist: number;
    startDomainX: [number, number];
    startDomainY: [number, number];
    centerX: number;
    centerY: number;
  } | null>(null);

  const [intraTouchState, setIntraTouchState] = useState<{
    startDist: number;
    startDomainX: [number, number];
    startDomainY: [number, number];
    centerX: number;
    centerY: number;
  } | null>(null);

  const handlePnLTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const currentX = pnlZoomX || [0, Math.max(0, processedChartData.length - 1)];
      const pnlValues = processedChartData.map(d => d.pnl);
      const minVal = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
      const maxVal = pnlValues.length > 0 ? Math.max(...pnlValues) : 100;
      const currentY = pnlZoomY || [minVal, maxVal];
      
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      const rect = pnlContainerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = centerX - rect.left;
        const y = centerY - rect.top;
        const gridLeft = 65;
        const gridRight = rect.width - 20;
        const gridTop = 20;
        const gridBottom = rect.height - 60;
        const gridWidth = gridRight - gridLeft;
        const gridHeight = gridBottom - gridTop;
        const pctX = Math.min(Math.max((x - gridLeft) / gridWidth, 0), 1);
        const pctY = Math.min(Math.max((gridBottom - y) / gridHeight, 0), 1);
        
        const mouseValX = currentX[0] + pctX * (currentX[1] - currentX[0]);
        const mouseValY = currentY[0] + pctY * (currentY[1] - currentY[0]);

        setPnLTouchState({
          startDist: dist,
          startDomainX: [currentX[0], currentX[1]],
          startDomainY: [Number(currentY[0]), Number(currentY[1])],
          centerX: mouseValX,
          centerY: mouseValY,
        });
      }
    }
  };

  const handlePnLTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pnlTouchState && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pnlTouchState.startDist > 0 && dist > 0) {
        const factor = pnlTouchState.startDist / dist;
        zoomXAxis(true, factor, pnlTouchState.centerX);
        zoomYAxis(true, factor, pnlTouchState.centerY);
      }
    }
  };

  const handlePnLTouchEnd = () => {
    setPnLTouchState(null);
  };

  const handleIntraTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const currentX = intraZoomX || defaultDomain;
      const currentY = intraZoomY || [0, 59];
      
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      const rect = intraContainerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = centerX - rect.left;
        const y = centerY - rect.top;
        const gridLeft = 65;
        const gridRight = rect.width - 20;
        const gridTop = 20;
        const gridBottom = rect.height - 60;
        const gridWidth = gridRight - gridLeft;
        const gridHeight = gridBottom - gridTop;
        const pctX = Math.min(Math.max((x - gridLeft) / gridWidth, 0), 1);
        const pctY = Math.min(Math.max((gridBottom - y) / gridHeight, 0), 1);
        
        const mouseValX = currentX[0] + pctX * (currentX[1] - currentX[0]);
        const mouseValY = currentY[0] + pctY * (currentY[1] - currentY[0]);

        setIntraTouchState({
          startDist: dist,
          startDomainX: [currentX[0], currentX[1]],
          startDomainY: [currentY[0], currentY[1]],
          centerX: mouseValX,
          centerY: mouseValY,
        });
      }
    }
  };

  const handleIntraTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (intraTouchState && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (intraTouchState.startDist > 0 && dist > 0) {
        const factor = intraTouchState.startDist / dist;
        zoomXAxis(false, factor, intraTouchState.centerX);
        zoomYAxis(false, factor, intraTouchState.centerY);
      }
    }
  };

  const handleIntraTouchEnd = () => {
    setIntraTouchState(null);
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
              {isPnLZoomed && (
                <button
                  onClick={handlePnLResetZoom}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded text-xs uppercase transition-all cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
            <div 
              ref={pnlContainerRef}
              onMouseDown={handlePnLMouseDown}
              onMouseMove={handlePnLMouseMove}
              onMouseUp={handlePnLMouseUp}
              onTouchStart={handlePnLTouchStart}
              onTouchMove={handlePnLTouchMove}
              onTouchEnd={handlePnLTouchEnd}
              onMouseLeave={handlePnLMouseUp}
              onDoubleClick={handlePnLResetZoom}
              className="h-[400px] select-none cursor-grab active:cursor-grabbing"
              title="Scroll to zoom (both or single axis), Drag to pan, Double-click to reset"
            >
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={processedChartData}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      type="number"
                      dataKey="index" 
                      domain={pnlXDomainCalculated}
                      ticks={pnlXTicks}
                      allowDataOverflow={true}
                      tickFormatter={(idx) => {
                        const point = processedChartData[Math.round(idx)];
                        return point ? formatTimestamp(point.timestamp) : '';
                      }}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis 
                      domain={pnlYDomainCalculated}
                      ticks={pnlYTicks}
                      allowDataOverflow={true}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        if (value % 1 === 0) return `₹${value}`;
                        return `₹${Number(value.toFixed(2)).toString()}`;
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#f1f5f9',
                      }}
                      labelFormatter={(idx) => {
                        const point = processedChartData[Math.round(idx)];
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
              {isIntraZoomed && (
                <button
                  onClick={handleIntraResetZoom}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded text-xs uppercase transition-all cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-slate-400 text-xs mb-4">
              Shows individual trades spread across the day (00:00 - 23:59). Zoom and pan to explore. Chart auto-zooms to the most active trading hours on load.
            </p>
            <div 
              ref={intraContainerRef}
              onMouseDown={handleIntraMouseDown}
              onMouseMove={handleIntraMouseMove}
              onMouseUp={handleIntraMouseUp}
              onTouchStart={handleIntraTouchStart}
              onTouchMove={handleIntraTouchMove}
              onTouchEnd={handleIntraTouchEnd}
              onMouseLeave={handleIntraMouseUp}
              onDoubleClick={handleIntraResetZoom}
              className="h-[400px] select-none cursor-grab active:cursor-grabbing"
              title="Scroll to zoom (both or single axis), Drag to pan, Double-click to reset"
            >
              {intradayData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      type="number"
                      dataKey="hour"
                      name="Hour"
                      domain={scatterXDomainCalculated}
                      ticks={scatterXTicks}
                      allowDataOverflow={true}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        const clamped = Math.min(24, Math.max(0, value));
                        const hr = Math.floor(clamped);
                        const mn = Math.round((clamped - hr) * 60);
                        return `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
                      }}
                      label={{ value: 'Time of Day (Hours)', position: 'insideBottom', offset: -10, fill: '#94a3b8', fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="minute"
                      name="Minute"
                      domain={scatterYDomainCalculated}
                      ticks={scatterYTicks}
                      allowDataOverflow={true}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        const clamped = Math.min(59, Math.max(0, value));
                        if (clamped % 1 === 0) return String(Math.floor(clamped)).padStart(2, '0');
                        const minInt = Math.floor(clamped);
                        const secs = Math.round((clamped - minInt) * 60);
                        return `${String(minInt).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                      }}
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
