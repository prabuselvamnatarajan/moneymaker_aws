/**
 * Positions-first list for deployment analysis.
 * Shows Position rows with nested expandable trades.
 */

import React, { useMemo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Link } from 'lucide-react';
import { Position } from '../types';
import { mapTrade } from '../adapters';

interface PositionsListProps {
  positions: Position[];
  positionsLoading: boolean;
  timezone: string;
  expandedPositions: Set<string>;
  setExpandedPositions: React.Dispatch<React.SetStateAction<Set<string>>>;
  formatCurrency: (v: number) => string;
  onSelectTransaction?: (tx: any) => void;
}

export default function PositionsList({
  positions,
  positionsLoading,
  timezone,
  expandedPositions,
  setExpandedPositions,
  formatCurrency,
  onSelectTransaction,
}: PositionsListProps) {
  const sortedPositions = useMemo(() => {
    return [...positions].sort((a, b) => {
      const ta = new Date(a.openedAt || 0).getTime();
      const tb = new Date(b.openedAt || 0).getTime();
      return tb - ta;
    });
  }, [positions]);

  const togglePosition = (key: string) => {
    setExpandedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatTime = (ts: string | null) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return d.toLocaleString('en-IN', {
        timeZone: timezone === 'UTC' ? 'UTC' : undefined,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return ts;
    }
  };

  const formatPct = (v: number) => {
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  };

  const pnlClass = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-rose-400');

  if (positionsLoading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
          <Link className="w-5 h-5 text-indigo-400" />
          Positions
        </h3>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (sortedPositions.length === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
          <Link className="w-5 h-5 text-indigo-400" />
          Positions
        </h3>
        <div className="text-center py-8 text-slate-500 text-sm">
          No positions found for this deployment. Positions are tracked from new trades going forward.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Link className="w-5 h-5 text-indigo-400" />
          Positions
          <span className="text-xs font-normal text-slate-500 ml-1">
            ({sortedPositions.length} positions · {sortedPositions.filter((p) => p.status === 'OPEN').length} open)
          </span>
        </h3>
      </div>
      <p className="text-slate-500 text-[11px] mb-4">
        Realised P&amp;L is net of commission. Unrealised / Max Up / Max Down are gross mark-to-market (exclude exit
        commission). Max Up / Max Down are the best and worst unrealised P&amp;L reached while the position was open.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="py-2 px-2 text-left w-8">#</th>
              <th className="py-2 px-2 text-left">Position</th>
              <th className="py-2 px-2 text-left">Dir</th>
              <th className="py-2 px-2 text-left">Status</th>
              <th className="py-2 px-2 text-right">Size</th>
              <th className="py-2 px-2 text-right">Buy Px</th>
              <th className="py-2 px-2 text-right">Sell Px</th>
              <th className="py-2 px-2 text-right">Realised</th>
              <th className="py-2 px-2 text-right">Unrealised</th>
              <th className="py-2 px-2 text-right">Max Up</th>
              <th className="py-2 px-2 text-right">Max Down</th>
              <th className="py-2 px-2 text-left">Opened</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sortedPositions.map((pos, idx) => {
              const key = pos.id;
              const isExpanded = expandedPositions.has(key);
              const hasTrades = (pos.trades?.length || 0) > 0;

              return (
                <React.Fragment key={key}>
                  <tr
                    className={`cursor-pointer transition-colors ${
                      isExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                    }`}
                    onClick={() => togglePosition(key)}
                  >
                    <td className="py-2.5 px-2 text-slate-500 font-mono">{idx + 1}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        {hasTrades ? (
                          isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )
                        ) : null}
                        <span className="font-mono text-slate-300 truncate max-w-[120px]" title={pos.positionId}>
                          {String(pos.positionId).slice(-10)}
                        </span>
                        <span className="text-[9px] px-1 py-0.5 bg-indigo-500/20 text-indigo-400 rounded font-bold">
                          {pos.trades?.length || 0}T
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${
                          pos.direction === 'LONG'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {pos.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${
                          pos.status === 'OPEN'
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {pos.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-300">
                      {pos.status === 'OPEN' ? `${pos.openSize}/${pos.totalSize}` : pos.totalSize}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-400">
                      {pos.buyPrice ? formatCurrency(pos.buyPrice) : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-400">
                      {pos.sellPrice ? formatCurrency(pos.sellPrice) : '—'}
                    </td>
                    <td className={`py-2.5 px-2 text-right font-mono font-bold ${pnlClass(pos.realisedPnl)}`}>
                      {pos.realisedPnl >= 0 ? '+' : ''}
                      {formatCurrency(pos.realisedPnl)}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-mono ${
                        pos.status === 'OPEN' ? pnlClass(pos.unrealisedPnl) : 'text-slate-600'
                      }`}
                    >
                      {pos.status === 'OPEN'
                        ? `${pos.unrealisedPnl >= 0 ? '+' : ''}${formatCurrency(pos.unrealisedPnl)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-emerald-400">
                      <div>
                        {pos.maxUp >= 0 ? '+' : ''}
                        {formatCurrency(pos.maxUp)}
                      </div>
                      <div className="text-[10px] text-emerald-500/70">{formatPct(pos.maxUpPct)}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-rose-400">
                      <div>{formatCurrency(pos.maxDown)}</div>
                      <div className="text-[10px] text-rose-500/70">{formatPct(pos.maxDownPct)}</div>
                    </td>
                    <td className="py-2.5 px-2 text-slate-400">{formatTime(pos.openedAt)}</td>
                  </tr>

                  {isExpanded &&
                    (pos.trades || []).map((trade: any, tIdx: number) => {
                      const tradeId = trade.trade_id || trade._id || String(tIdx);
                      const isSell = (trade.type_of_order || '').toUpperCase() === 'SELL';
                      const qty = trade.quantity || 0;
                      const price = trade.price || 0;
                      const amountSpent = isSell ? qty * price : -(qty * price);
                      const execTime = trade.execution_time || trade.created_at || '';
                      return (
                        <tr key={`${key}-trade-${tradeId}`} className="bg-slate-950/50">
                          <td className="py-2 px-2 text-slate-600 font-mono pl-6">{tIdx + 1}</td>
                          <td className="py-2 px-2" colSpan={2}>
                            <div className="flex items-center gap-1.5 pl-4">
                              <span
                                className="font-mono text-slate-400 text-[11px] truncate max-w-[160px]"
                                title={String(tradeId)}
                              >
                                {String(tradeId)}
                              </span>
                              <ExternalLink
                                className="w-3 h-3 text-slate-600 cursor-pointer hover:text-indigo-400 shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTransaction?.(mapTrade(trade));
                                }}
                              />
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${
                                isSell ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                              }`}
                            >
                              {isSell ? 'SELL' : 'BUY'}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-slate-300">{qty}</td>
                          <td className="py-2 px-2 text-right font-mono text-slate-400" colSpan={2}>
                            {price ? formatCurrency(price) : '—'}
                          </td>
                          <td className={`py-2 px-2 text-right font-mono ${pnlClass(trade.pnl || 0)}`}>
                            {trade.pnl != null
                              ? `${(trade.pnl || 0) >= 0 ? '+' : ''}${formatCurrency(trade.pnl || 0)}`
                              : '—'}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-slate-500" colSpan={2}>
                            <span className={amountSpent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {formatCurrency(amountSpent)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-400 text-[11px]" colSpan={2}>
                            {formatTime(execTime)}
                          </td>
                        </tr>
                      );
                    })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
