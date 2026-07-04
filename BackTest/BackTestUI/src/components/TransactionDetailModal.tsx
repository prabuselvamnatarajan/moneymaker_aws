/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Flag, ArrowUpRight, ArrowDownRight, FileJson, Clock, CheckCircle2, AlertTriangle, HelpCircle, Copy, Download } from 'lucide-react';
import { Transaction, Account, Strategy, SymbolData } from '../types';

interface TransactionDetailModalProps {
  transaction: Transaction;
  accounts: Account[];
  strategies: Strategy[];
  symbols: SymbolData[];
  onClose: () => void;
  onToggleFlag: (txId: string) => void;
  onUpdateNotes: (txId: string, notes: string) => void;
  onNavigateToEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  timezone: string;
}

export default function TransactionDetailModal({
  transaction,
  accounts,
  strategies,
  symbols,
  onClose,
  onToggleFlag,
  onUpdateNotes,
  onNavigateToEntity,
  timezone,
}: TransactionDetailModalProps) {
  const [notesText, setNotesText] = useState(transaction.notes);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copied, setCopied] = useState(false);

  const matchedAccount = accounts.find((a) => a.id === transaction.accountId);
  const matchedStrategy = strategies.find((s) => s.id === transaction.strategyId);
  const matchedSymbol = symbols.find((s) => s.ticker === transaction.symbol);

  // Formatting date according to selected timezone
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        timeZone: timezone === 'UTC' ? 'UTC' : undefined,
        hour12: false,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + (timezone === 'UTC' ? ' (UTC)' : ' (Local)');
    } catch (e) {
      return isoString;
    }
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(transaction, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalValue = transaction.quantity * (transaction.avgPrice || transaction.price);

  return (
    <div id="tx-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs transition-opacity">
      <div 
        id="tx-modal-container"
        className="w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 text-slate-100 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950 font-sans">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded-sm text-xs font-semibold tracking-wider font-mono ${
              transaction.type === 'BUY' 
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' 
                : 'bg-rose-950 text-rose-400 border border-rose-900'
            }`}>
              {transaction.type}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold font-mono tracking-tight">{transaction.id}</h2>
                {transaction.flagged && (
                  <span className="flex items-center gap-1 text-[10px] uppercase font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20">
                    <Flag className="w-2.5 h-2.5 fill-amber-400" /> Flagged
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3 text-slate-500" />
                {formatDate(transaction.timestamp)}
              </p>
            </div>
          </div>
          <button 
            id="close-tx-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Status & Quick Stats */}
          <div className="grid grid-cols-3 gap-3 bg-slate-950 p-4 rounded-lg border border-slate-800 font-sans">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono">Status</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full ${
                  transaction.status === 'EXECUTED' ? 'bg-emerald-500 animate-pulse' :
                  transaction.status === 'PENDING' ? 'bg-amber-500' : 'bg-slate-500'
                }`} />
                <span className="text-sm font-semibold tracking-wide text-slate-200">{transaction.status}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono">Total Value</p>
              <p className="text-sm font-bold text-emerald-400 mt-1">
                ₹{totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold font-mono font-sans">Broker Commission</p>
              <p className="text-sm font-medium text-slate-200 mt-1 font-mono">
                ₹{transaction.fee.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Connected Entities Grid */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">Linked Platform Entities</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Account Card */}
              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition-colors group">
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">Account</p>
                  <p className="text-sm font-semibold text-slate-200 mt-1 truncate">{matchedAccount?.name || transaction.accountId}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{matchedAccount?.broker || 'Standard Broker'}</p>
                </div>
                <button
                  id={`goto-acc-btn-${transaction.accountId}`}
                  onClick={() => onNavigateToEntity('account', transaction.accountId)}
                  className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline text-left group-hover:translate-x-0.5 transition-transform"
                >
                  View Account <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>

              {/* Strategy Card */}
              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition-colors group">
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">Strategy</p>
                  <p className="text-sm font-semibold text-slate-200 mt-1 truncate">{matchedStrategy?.name || 'Manual Trade'}</p>
                  <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 mt-1 rounded font-mono ${
                    matchedStrategy?.mode === 'live' 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                      : matchedStrategy?.mode === 'paper'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    {matchedStrategy?.mode?.toUpperCase() || 'BACKTEST'}
                  </span>
                </div>
                <button
                  id={`goto-strat-btn-${transaction.strategyId}`}
                  onClick={() => onNavigateToEntity('strategy', transaction.strategyId)}
                  className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline text-left group-hover:translate-x-0.5 transition-transform"
                >
                  View Strategy <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>

              {/* Symbol Card */}
              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition-colors group">
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">Symbol</p>
                  <p className="text-sm font-mono font-bold text-slate-200 mt-1 truncate">{transaction.symbol}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{matchedSymbol?.name || 'N/A'}</p>
                </div>
                <button
                  id={`goto-sym-btn-${transaction.symbol}`}
                  onClick={() => onNavigateToEntity('symbol', transaction.symbol)}
                  className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline text-left group-hover:translate-x-0.5 transition-transform"
                >
                  View Symbol <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Execution Specs & Identification */}
          <div className="space-y-3 font-sans">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">Execution Parameters</h3>
            <div className="bg-slate-950 rounded-lg border border-slate-800 divide-y divide-slate-800/65 font-mono">
              <div className="grid grid-cols-2 p-3 text-xs">
                <span className="text-slate-400">Execution Hash ID</span>
                <span className="text-right text-slate-200 select-all font-semibold">{transaction.tradeId}</span>
              </div>
              <div className="grid grid-cols-2 p-3 text-xs">
                <span className="text-slate-400">Order Booking ID</span>
                <span className="text-right text-slate-200 select-all font-semibold">{transaction.orderId}</span>
              </div>
              <div className="grid grid-cols-2 p-3 text-xs">
                <span className="text-slate-400">Contract Size (Qty)</span>
                <span className="text-right text-slate-200 font-semibold">
                  {transaction.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
              </div>
              <div className="grid grid-cols-2 p-3 text-xs">
                <span className="text-slate-400">Execution Price</span>
                <span className="text-right text-slate-200 font-semibold">
                  ₹{transaction.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
              </div>
              <div className="grid grid-cols-2 p-3 text-xs">
                <span className="text-slate-400">Broker Filled Quantity</span>
                <span className="text-right text-slate-200 font-semibold">
                  {transaction.filledQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} ({transaction.status === 'EXECUTED' ? '100' : '0'}%)
                </span>
              </div>
              <div className="grid grid-cols-2 p-3 text-xs">
                <span className="text-slate-400">Average Fill Price</span>
                <span className="text-right text-slate-200 font-semibold">
                  ₹{transaction.avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
              </div>
            </div>
          </div>

          {/* Audit Timeline */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">Platform Audit Timeline</h3>
            {transaction.events && transaction.events.length > 0 ? (
              <div className="pl-2 border-l-2 border-slate-800 space-y-4">
                {transaction.events.map((event, i) => (
                  <div key={i} className="relative pl-6">
                    {/* Bullet marker */}
                    <span className={`absolute -left-[15px] top-1.5 w-2 h-2 rounded-full border border-slate-900 ${
                      event.type === 'success' ? 'bg-emerald-500' :
                      event.type === 'warning' ? 'bg-amber-500' :
                      event.type === 'error' ? 'bg-red-500 animate-ping' : 'bg-indigo-400'
                    }`} />
                    <p className="text-xs text-slate-200 leading-relaxed font-sans">{event.message}</p>
                    <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">{formatDate(event.time)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic font-sans py-2">No system audit records logged for this manual or historical trade.</p>
            )}
          </div>

          {/* Audit Notes Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">Auditor Remarks & Annotations</h3>
              <span className="text-[10px] text-slate-500">Auto-saved</span>
            </div>
            <textarea
              id={`notes-textarea-${transaction.id}`}
              value={notesText}
              onChange={(e) => {
                setNotesText(e.target.value);
                onUpdateNotes(transaction.id, e.target.value);
              }}
              placeholder="Add professional compliance notes, strategy overrides, or flagging comments..."
              className="w-full h-24 bg-slate-950 border border-slate-800 rounded-md p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition-colors font-sans resize-none"
            />
          </div>

          {/* Raw JSON disclosure */}
          <div className="border border-slate-800 rounded-md overflow-hidden bg-slate-950 font-sans">
            <button
              id={`toggle-raw-json-btn`}
              onClick={() => setShowRawJson(!showRawJson)}
              className="w-full flex items-center justify-between p-3.5 hover:bg-slate-900 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs font-mono font-medium text-slate-300">
                <FileJson className="w-4 h-4 text-slate-400" />
                Raw Execution Event Payload
              </div>
              <span className="text-[11px] text-indigo-400 hover:text-indigo-300 font-mono">
                {showRawJson ? 'Hide' : 'Inspect'}
              </span>
            </button>
            
            {showRawJson && (
              <div className="border-t border-slate-800 p-4 bg-slate-950 overflow-x-auto text-left relative group">
                {/* Float buttons */}
                <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={handleCopyJson}
                    className="p-1 rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 font-mono transition-colors"
                    title="Copy payload to clipboard"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-emerald-400 leading-normal leading-relaxed select-all">
                  {JSON.stringify(transaction, null, 2)}
                </pre>
              </div>
            )}
          </div>

        </div>

        {/* Footer actions */}
        <div className="p-6 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-3 font-sans">
          <button
            id={`flag-audit-btn-${transaction.id}`}
            onClick={() => onToggleFlag(transaction.id)}
            className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 border transition-all ${
              transaction.flagged 
                ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30' 
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
            }`}
          >
            <Flag className={`w-3.5 h-3.5 ${transaction.flagged ? 'fill-amber-400 text-amber-400' : ''}`} />
            {transaction.flagged ? 'Unflag Transaction' : 'Flag for Audit'}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="px-3.5 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5 border border-slate-800 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copy JSON
            </button>
            <button
              onClick={() => {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(transaction, null, 2));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href",     dataStr);
                downloadAnchor.setAttribute("download", `transaction-${transaction.id}.json`);
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
              }}
              className="px-3.5 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5" /> Export Record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
