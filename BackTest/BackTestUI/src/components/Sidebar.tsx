/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  LayoutDashboard, TableProperties, Landmark, Cpu, LineChart, 
  Settings, Clock, Activity, Power, Globe, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { ViewScreen, Account, Strategy, SymbolData } from '../types';

interface SidebarProps {
  activeScreen: ViewScreen;
  onNavigate: (screen: ViewScreen) => void;
  accounts: Account[];
  strategies: Strategy[];
  symbols: SymbolData[];
  selectedEntityId: string | null;
  onSelectEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  timezone: string;
  onTimezoneChange: (tz: 'UTC' | 'Local') => void;
  currentUser: { name: string; email: string } | null;
}

export default function Sidebar({
  activeScreen,
  onNavigate,
  accounts,
  strategies,
  symbols,
  selectedEntityId,
  onSelectEntity,
  timezone,
  onTimezoneChange,
  currentUser,
}: SidebarProps) {
  
  const connectedAccountsCount = accounts.filter(a => a.status === 'connected').length;
  const activeStrategiesCount = strategies.filter(s => s.status === 'active').length;

  return (
    <aside id="sidebar-container" className="w-64 bg-slate-950 border-r border-slate-800 text-slate-100 flex flex-col justify-between h-screen sticky top-0 font-sans shrink-0">
      
      {/* Brand Header */}
      <div>
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center font-bold text-white">C</div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white uppercase">CobraTrades</h1>
              <p className="text-[10px] text-slate-500 font-mono tracking-wide">ALGO AUDIT ENGINE</p>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[9px] bg-emerald-500/10 text-emerald-400 font-mono px-1.5 py-0.5 rounded border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>

        {/* Global Navigation links */}
        <div className="px-4 py-4 space-y-1">
          <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Console Views</p>
          
          <button
            id="nav-dashboard-btn"
            onClick={() => onNavigate('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all ${
              activeScreen === 'dashboard' 
                ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <LayoutDashboard className="w-4 h-4 text-indigo-400" />
            <span>Dashboard Overview</span>
          </button>

          <button
            id="nav-transactions-btn"
            onClick={() => onNavigate('transactions')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all ${
              activeScreen === 'transactions' 
                ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <TableProperties className="w-4 h-4 text-emerald-400" />
            <span>Transactions Ledger</span>
          </button>

          <button
            id="nav-brokers-btn"
            onClick={() => onNavigate('brokers-list')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all ${
              activeScreen === 'brokers-list' 
                ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Globe className="w-4 h-4 text-amber-400" />
            <span>Brokers Directory</span>
          </button>
        </div>

        {/* Quick Lists / Drilldown Shortcuts */}
        <div className="px-4 py-2 space-y-3.5 overflow-y-auto max-h-[50vh]">
          {/* Strategies Group */}
          <div>
            <div className="px-3 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
              <button 
                onClick={() => onNavigate('strategies-list')}
                className={`flex items-center gap-1.5 hover:text-indigo-400 transition-colors text-left font-bold cursor-pointer ${activeScreen === 'strategies-list' ? 'text-indigo-400' : 'text-slate-500'}`}
              >
                <span>Deployments ({activeStrategiesCount})</span>
                <span className="text-[9px] font-normal text-slate-600 font-sans hover:underline">(View All)</span>
              </button>
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="space-y-0.5 pl-1">
              {strategies.map(s => {
                const isSelected = activeScreen === 'strategy-detail' && selectedEntityId === s.id;
                return (
                  <button
                    key={s.id}
                    id={`sidebar-strat-${s.id}`}
                    onClick={() => onSelectEntity('strategy', s.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[11px] truncate flex items-center justify-between transition-colors ${
                      isSelected 
                        ? 'bg-slate-900 text-slate-100 font-bold border-r border-indigo-400' 
                        : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      s.status === 'active' ? 'bg-emerald-500' :
                      s.status === 'paused' ? 'bg-amber-500' : 'bg-slate-600'
                    }`} title={`Status: ${s.status}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Connected Brokers Group */}
          <div>
            <div className="px-3 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
              <button 
                onClick={() => onNavigate('accounts-list')}
                className={`flex items-center gap-1.5 hover:text-indigo-400 transition-colors text-left font-bold cursor-pointer ${activeScreen === 'accounts-list' ? 'text-indigo-400' : 'text-slate-500'}`}
              >
                <span>Accounts ({connectedAccountsCount})</span>
                <span className="text-[9px] font-normal text-slate-600 font-sans hover:underline">(View All)</span>
              </button>
              <Landmark className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="space-y-0.5 pl-1">
              {accounts.map(a => {
                const isSelected = activeScreen === 'account-detail' && selectedEntityId === a.id;
                return (
                  <button
                    key={a.id}
                    id={`sidebar-acc-${a.id}`}
                    onClick={() => onSelectEntity('account', a.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[11px] truncate flex items-center justify-between transition-colors ${
                      isSelected 
                        ? 'bg-slate-900 text-slate-100 font-bold border-r border-indigo-400' 
                        : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{a.name}</span>
                    <span className={`text-[9px] font-mono ${a.status === 'connected' ? 'text-emerald-500' : 'text-slate-600'}`}>
                      {a.status === 'connected' ? '●' : '○'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tracked Symbols Group */}
          <div>
            <div className="px-3 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
              <button 
                onClick={() => onNavigate('symbols-list')}
                className={`flex items-center gap-1.5 hover:text-indigo-400 transition-colors text-left font-bold cursor-pointer ${activeScreen === 'symbols-list' ? 'text-indigo-400' : 'text-slate-500'}`}
              >
                <span>Tracked Symbols</span>
                <span className="text-[9px] font-normal text-slate-600 font-sans hover:underline">(View All)</span>
              </button>
              <LineChart className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="space-y-0.5 pl-1">
              {symbols.map(sym => {
                const isSelected = activeScreen === 'symbol-detail' && selectedEntityId === sym.ticker;
                const isPositive = sym.change24h >= 0;
                return (
                  <button
                    key={sym.ticker}
                    id={`sidebar-sym-${sym.ticker.replace('/', '-')}`}
                    onClick={() => onSelectEntity('symbol', sym.ticker)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[11px] font-mono flex items-center justify-between transition-colors ${
                      isSelected 
                        ? 'bg-slate-900 text-slate-100 font-bold border-r border-indigo-400' 
                        : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                    }`}
                  >
                    <span>{sym.ticker}</span>
                    <span className={isPositive ? 'text-emerald-500' : 'text-rose-500'}>
                      {isPositive ? '+' : ''}{sym.change24h}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer System Panel */}
      <div className="p-4 bg-slate-950 border-t border-slate-800">
        
        {/* Timezone Switcher Selector */}
        <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs mb-3">
          <div className="flex items-center gap-1.5 text-slate-400 font-mono">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Timezone</span>
          </div>
          <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              onClick={() => onTimezoneChange('UTC')}
              className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold transition-all ${
                timezone === 'UTC' 
                  ? 'bg-indigo-600 text-white' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              UTC
            </button>
            <button
              onClick={() => onTimezoneChange('Local')}
              className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold transition-all ${
                timezone === 'Local' 
                  ? 'bg-indigo-600 text-white' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              LOC
            </button>
          </div>
        </div>
 
        {/* User Identity Info */}
        <button
          onClick={() => onNavigate('profile')}
          className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all cursor-pointer ${
            activeScreen === 'profile'
              ? 'bg-indigo-600/10 border border-indigo-500/20'
              : 'hover:bg-slate-900 border border-transparent'
          }`}
        >
          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
            activeScreen === 'profile'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-slate-800 border border-slate-700 text-slate-300'
          }`}>
            {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('') : 'PS'}
          </div>
          <div className="truncate flex-1">
            <h4 className="text-xs font-bold text-slate-200 truncate">{currentUser?.name || 'Prabu Selvam'}</h4>
            <p className="text-[10px] text-slate-500 truncate font-mono">{currentUser?.email || 'prabuselvamonline@gmail.com'}</p>
          </div>
        </button>
      </div>
    </aside>
  );
}
