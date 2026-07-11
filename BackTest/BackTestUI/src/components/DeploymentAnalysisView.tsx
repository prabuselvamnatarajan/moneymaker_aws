/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ScatterChart, Scatter, ZAxis } from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, ArrowUpRight, ArrowDownRight, Calendar, Search, Clock } from 'lucide-react';
import { DeploymentAnalysis, TimeSeriesDataPoint, IntradayTradeDataPoint, Deployment } from '../types';
import { api } from '../api';
import { useToast } from './Toast';

interface DeploymentAnalysisViewProps {
  selectedDeploymentId: string | null;
  timezone?: string;
}

const TIME_OPTIONS = [
  { value: '', label: 'Select Time' },
  { value: '00:00:00', label: '00:00:00 (Midnight)' },
  { value: '01:00:00', label: '01:00:00' },
  { value: '02:00:00', label: '02:00:00' },
  { value: '03:00:00', label: '03:00:00' },
  { value: '04:00:00', label: '04:00:00' },
  { value: '05:00:00', label: '05:00:00' },
  { value: '06:00:00', label: '06:00:00' },
  { value: '07:00:00', label: '07:00:00' },
  { value: '08:00:00', label: '08:00:00' },
  { value: '09:00:00', label: '09:00:00' },
  { value: '09:15:00', label: '09:15:00 (NSE Open)' },
  { value: '09:30:00', label: '09:30:00' },
  { value: '10:00:00', label: '10:00:00' },
  { value: '10:30:00', label: '10:30:00' },
  { value: '11:00:00', label: '11:00:00' },
  { value: '11:30:00', label: '11:30:00' },
  { value: '12:00:00', label: '12:00:00' },
  { value: '12:30:00', label: '12:30:00' },
  { value: '13:00:00', label: '13:00:00' },
  { value: '13:30:00', label: '13:30:00' },
  { value: '14:00:00', label: '14:00:00' },
  { value: '14:30:00', label: '14:30:00' },
  { value: '15:00:00', label: '15:00:00' },
  { value: '15:30:00', label: '15:30:00 (NSE Close)' },
  { value: '16:00:00', label: '16:00:00' },
  { value: '17:00:00', label: '17:00:00' },
  { value: '18:00:00', label: '18:00:00' },
  { value: '19:00:00', label: '19:00:00' },
  { value: '20:00:00', label: '20:00:00' },
  { value: '21:00:00', label: '21:00:00' },
  { value: '22:00:00', label: '22:00:00' },
  { value: '23:00:00', label: '23:00:00' },
  { value: '23:30:00', label: '23:30:00' },
  { value: '23:59:59', label: '23:59:59 (End of Day)' }
];

export default function DeploymentAnalysisView({ selectedDeploymentId, timezone = 'UTC' }: DeploymentAnalysisViewProps) {
  const { showError } = useToast();
  
  const [deploymentId, setDeploymentId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [analysis, setAnalysis] = useState<DeploymentAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [chartData, setChartData] = useState<TimeSeriesDataPoint[]>([]);
  const [intradayData, setIntradayData] = useState<IntradayTradeDataPoint[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [defaultDomain, setDefaultDomain] = useState<[number, number]>([0, 24]);

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
      
      // Process intraday trades and find data-heavy region
      const intradayTrades = result.data.intraday_trades || [];
      setIntradayData(intradayTrades);
      
      // Calculate the default zoom domain based on trade density
      if (intradayTrades.length > 0) {
        const hourBuckets = new Map<number, number>();
        for (let i = 0; i < 24; i++) {
          hourBuckets.set(i, 0);
        }
        
        intradayTrades.forEach(trade => {
          const count = hourBuckets.get(trade.hour) || 0;
          hourBuckets.set(trade.hour, count + 1);
        });
        
        // Find the hour with most trades
        let maxHour = 0;
        let maxCount = 0;
        hourBuckets.forEach((count, hour) => {
          if (count > maxCount) {
            maxCount = count;
            maxHour = hour;
          }
        });
        
        // Set default domain to center around the busiest hour (±3 hours)
        const startHour = Math.max(0, maxHour - 3);
        const endHour = Math.min(24, maxHour + 3);
        setDefaultDomain([startHour, endHour]);
      } else {
        setDefaultDomain([0, 24]);
      }
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
              Start Time
            </label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
              End Time
            </label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
            <h3 className="text-lg font-bold text-slate-100 mb-4">Profit & Loss Over Time</h3>
            <div className="h-[400px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatTimestamp}
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis 
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
                      labelFormatter={(label) => formatTimestamp(label)}
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
            <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-cyan-400" />
              Intraday Trade Distribution (UTC)
            </h3>
            <p className="text-slate-400 text-xs mb-4">
              Shows individual trades spread across the day (00:00 - 23:59). Zoom and pan to explore. Chart auto-zooms to the most active trading hours on load.
            </p>
            <div className="h-[400px]">
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
                      domain={defaultDomain}
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
                      domain={[0, 59]}
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
