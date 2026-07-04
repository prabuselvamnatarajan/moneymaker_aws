/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Plus, Search, Landmark, ShieldCheck, ShieldAlert, DollarSign, 
  Activity, ArrowRight, ChevronRight, X, Sparkles 
} from 'lucide-react';
import { Account } from '../types';

interface AccountsListViewProps {
  accounts: Account[];
  onAddAccount: (newAcc: Account) => void;
  onToggleBrokerStatus: (id: string) => void;
  onNavigateToEntity: (type: 'account', id: string) => void;
}

export default function AccountsListView({
  accounts,
  onAddAccount,
  onToggleBrokerStatus,
  onNavigateToEntity
}: AccountsListViewProps) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form fields
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [balance, setBalance] = useState('');
  const [margin, setMargin] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [status, setStatus] = useState<'connected' | 'disconnected'>('connected');
  const [commissionType, setCommissionType] = useState<'PERCENTAGE' | 'FLAT'>('PERCENTAGE');
  const [commissionRate, setCommissionRate] = useState('');

  // Computed metrics
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalPnl = accounts.reduce((sum, a) => sum + a.pnl, 0);
  const connectedCount = accounts.filter(a => a.status === 'connected').length;

  const filteredAccounts = accounts.filter(a => 
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.broker.toLowerCase().includes(search.toLowerCase()) ||
    a.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !broker || !balance) return;

    const initialVal = parseFloat(balance);
    const marginVal = margin ? parseFloat(margin) : initialVal * 0.7;

    const newAcc: Account = {
      id: `ACC-00${accounts.length + 1}`,
      name,
      broker,
      balance: initialVal,
      margin: marginVal,
      initialBalance: initialVal,
      pnl: 0,
      currency,
      status,
      commissionType,
      commissionRate: commissionRate ? parseFloat(commissionRate) : 0,
    };

    onAddAccount(newAcc);
    
    // Reset form
    setName('');
    setBroker('');
    setBalance('');
    setMargin('');
    setStatus('connected');
    setCommissionType('PERCENTAGE');
    setCommissionRate('');
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Landmark className="w-5 h-5 text-indigo-400" />
            Brokerage Accounts Directory
          </h2>
          <p className="text-xs text-slate-500">
            Audit and configure registered brokerage connections, leverage boundaries, and capital distribution.
          </p>
        </div>
        
        <button
          id="btn-register-account-trigger"
          onClick={() => setShowAddForm(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 shrink-0 self-start sm:self-center"
        >
          <Plus className="w-4 h-4" /> Register New Account
        </button>
      </div>

      {/* Aggregate Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-sans">
        
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Total Net Liquidation</p>
          <p className="text-xl font-black font-mono text-slate-100 mt-1.5">
            ₹{totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Overall Capital P&L</p>
          <p className={`text-xl font-black font-mono mt-1.5 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Connection Stability</p>
          <p className="text-xl font-bold font-mono text-slate-100 mt-1.5">
            {connectedCount} / {accounts.length} <span className="text-xs text-slate-500 font-normal">Active</span>
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Average Capital Density</p>
          <p className="text-xl font-bold font-mono text-indigo-400 mt-1.5">
            ₹{(totalBalance / (accounts.length || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>

      </div>

      {/* Filters Bar */}
      <div className="flex items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts by name, API provider, ID..."
            className="w-full bg-slate-900 border border-slate-800 rounded-md pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 font-sans"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Accounts Ledger Grid / List */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden font-sans">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
          <span className="text-xs font-bold text-slate-300">Registered Brokerage Records ({filteredAccounts.length})</span>
          <span className="text-[10px] text-slate-500 font-mono">Toggling connection triggers system audits</span>
        </div>

        {filteredAccounts.length > 0 ? (
          <div className="divide-y divide-slate-800/60">
            {filteredAccounts.map(acc => {
              const isPnlPositive = acc.pnl >= 0;
              const isConnected = acc.status === 'connected';
              return (
                <div 
                  key={acc.id}
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-indigo-600/5 transition-colors group select-none"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-slate-900 rounded-lg text-indigo-400 border border-slate-850 shrink-0 mt-0.5">
                      <Landmark className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 hover:text-indigo-400 transition-colors cursor-pointer" onClick={() => onNavigateToEntity('account', acc.id)}>
                          {acc.name}
                        </span>
                        <span className="text-[10px] font-mono bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded border border-slate-800">
                          {acc.id}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        API Provider: <span className="text-slate-400">{acc.broker}</span>
                        {acc.commissionRate !== undefined && (
                          <span className="text-slate-500">
                            {' • Commission: '}
                            <span className="text-slate-400">
                              {acc.commissionType === 'FLAT' ? `₹${acc.commissionRate}` : `${acc.commissionRate}%`}
                            </span>
                          </span>
                        )}
                      </p>
                      
                      {/* Connection status toggle pill */}
                      <button 
                        onClick={() => onToggleBrokerStatus(acc.id)}
                        className={`inline-flex items-center gap-1.5 mt-2.5 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                          isConnected 
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30' 
                            : 'bg-rose-950/40 text-rose-400 border-rose-900/30'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                        {isConnected ? 'API SESSION ACTIVE' : 'API DISCONNECTED'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 md:gap-12">
                    
                    {/* Balance */}
                    <div className="space-y-0.5 min-w-[100px]">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Total Balance</p>
                      <p className="text-sm font-bold font-mono text-slate-200">
                        ₹{acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>

                    {/* Margin */}
                    <div className="space-y-0.5 min-w-[100px]">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Available Margin</p>
                      <p className="text-xs font-semibold font-mono text-slate-400">
                        ₹{acc.margin.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                      </p>
                    </div>

                    {/* Cumulative Yield */}
                    <div className="space-y-0.5 min-w-[100px]">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Account P&L</p>
                      <p className={`text-sm font-bold font-mono ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPnlPositive ? '+' : ''}₹{acc.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>

                    {/* Drilling navigation */}
                    <button
                      onClick={() => onNavigateToEntity('account', acc.id)}
                      className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg transition-all flex items-center gap-1 text-xs cursor-pointer group-hover:translate-x-0.5 duration-200"
                    >
                      Audit Ledger <ChevronRight className="w-4 h-4" />
                    </button>

                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500">
            No registered brokerage accounts matched your search queries.
          </div>
        )}
      </div>

      {/* Add Account Modal Overlay */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Landmark className="w-4 h-4 text-indigo-400" />
                Register New Brokerage
              </h3>
              <button 
                onClick={() => setShowAddForm(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Account Friendly Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Apex Arbitrage Pro"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">API Broker / Exchange</label>
                <input
                  type="text"
                  required
                  value={broker}
                  onChange={(e) => setBroker(e.target.value)}
                  placeholder="e.g. Interactive Brokers, Binance Pro"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Initial Deposit (INR)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Available Margin (INR)</label>
                  <input
                    type="number"
                    min="0"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    placeholder="Default: 70% of deposit"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Commission Type</label>
                  <select
                    value={commissionType}
                    onChange={(e) => setCommissionType(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FLAT">Flat Fee (INR)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">
                    Commission Rate ({commissionType === 'PERCENTAGE' ? '%' : '₹'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value)}
                    placeholder={commissionType === 'PERCENTAGE' ? "e.g. 0.05" : "e.g. 20"}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Base Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="INR">INR (₹)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Initial Hook Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="connected">Connected (Active Session)</option>
                    <option value="disconnected">Disconnected (Standby Mode)</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Save Broker Record
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}
