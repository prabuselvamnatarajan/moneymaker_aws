/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Activity, Filter } from 'lucide-react';
import { api } from '../api';
import { SweepSignalLog, SweepSignalStats } from '../types';

interface SweepSignalLogViewProps {
  deploymentId: string;
}

export default function SweepSignalLogView({ deploymentId }: SweepSignalLogViewProps) {
  const [stats, setStats] = useState<SweepSignalStats | null>(null);
  const [logs, setLogs] = useState<SweepSignalLog[]>([]);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [statsRes, logsRes] = await Promise.all([
        api.deployments.getSweepSignalStats(deploymentId),
        api.deployments.getSweepSignals(deploymentId, {
          outcome: outcomeFilter || undefined,
          limit: 100,
        }),
      ]);
      setStats(statsRes.data);
      setLogs(logsRes.items || []);
    } catch (err) {
      console.error('Failed to load sweep signals', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deploymentId) {
      load();
    }
  }, [deploymentId, outcomeFilter]);

  if (loading && !stats) {
    return <div className="p-6 text-slate-400 text-sm">Loading sweep signal logs...</div>;
  }

  const total = stats?.total ?? 0;
  const confirmedPct = stats ? (stats.confirmationRate * 100).toFixed(1) : '0';
  const invalidated = stats?.byOutcome.find((o) => o.outcome === 'invalidated_continuation')?.count ?? 0;
  const timeout = stats?.byOutcome.find((o) => o.outcome === 'timeout')?.count ?? 0;
  const dataGap = stats?.byOutcome.find((o) => o.outcome === 'data_gap')?.count ?? 0;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-slate-200">
        <Activity size={18} />
        <h3 className="font-semibold text-sm">Liquidity Sweep Signal Log</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Total Sweeps</p>
          <p className="text-xl font-bold text-slate-100">{total}</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Confirmed</p>
          <p className="text-xl font-bold text-emerald-400">{confirmedPct}%</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Invalidated</p>
          <p className="text-xl font-bold text-amber-400">{invalidated}</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Timeout</p>
          <p className="text-xl font-bold text-slate-300">{timeout}</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Data Gap</p>
          <p className="text-xl font-bold text-red-400">{dataGap}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Filter size={14} className="text-slate-400" />
        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1"
        >
          <option value="">All outcomes</option>
          <option value="rejection_confirmed">Rejection confirmed</option>
          <option value="invalidated_continuation">Invalidated</option>
          <option value="timeout">Timeout</option>
          <option value="data_gap">Data gap</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full min-w-[800px] text-xs">
          <thead className="bg-slate-800 text-slate-400 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Outcome</th>
              <th className="px-3 py-2 text-left">Level</th>
              <th className="px-3 py-2 text-left">Direction</th>
              <th className="px-3 py-2 text-right">LTP</th>
              <th className="px-3 py-2 text-right">Extreme</th>
              <th className="px-3 py-2 text-right">Ticks</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No sweep signals recorded yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log._id} className="border-t border-slate-700/50 hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-300">
                    {new Date(log.created_at || log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-slate-200">{log.outcome}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {log.levelType || '—'} {log.level != null ? `@ ${log.level.toFixed(2)}` : ''}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{log.direction || '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-200">{log.ltp?.toFixed(2) ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-200">{log.sweepExtreme?.toFixed(2) ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{log.tickCount ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
