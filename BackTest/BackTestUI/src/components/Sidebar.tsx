/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, TableProperties, Landmark, Cpu, LineChart, 
  Clock, Globe, X, Layers, ChevronDown, Search, HardDrive
} from 'lucide-react';
import { ViewScreen, Account, Strategy, SymbolData } from '../types';

interface SidebarProps {
  activeScreen: ViewScreen;
  onNavigate: (screen: ViewScreen) => void;
  accounts: Account[];
  strategies: Strategy[];
  symbols: SymbolData[];
  strategyDefinitions?: any[];
  selectedEntityId: string | null;
  onSelectEntity: (type: 'account' | 'strategy' | 'symbol', id: string) => void;
  timezone: string;
  onTimezoneChange: (tz: 'UTC' | 'Local') => void;
  currentUser: { name: string; email: string } | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({
  activeScreen,
  onNavigate,
  accounts,
  strategies,
  symbols,
  strategyDefinitions = [],
  selectedEntityId,
  onSelectEntity,
  timezone,
  onTimezoneChange,
  currentUser,
  isOpen,
  onClose,
}: SidebarProps) {
  
  const connectedAccountsCount = accounts.filter(a => a.status === 'connected').length;
  const activeStrategiesCount = strategies.filter(s => s.status === 'active' && s.name.toLowerCase() !== 'manual').length;
  const visibleDefinitions = strategyDefinitions.filter(s => s.strategy_name.toLowerCase() !== 'manual');

  // Track symbol filter query
  const [symbolQuery, setSymbolQuery] = useState('');

  // Track accordion expanded states
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => ({
    deployments: activeScreen === 'strategies-list' || activeScreen === 'strategy-detail',
    strategies: activeScreen === 'strategy-templates',
    accounts: activeScreen === 'accounts-list' || activeScreen === 'account-detail',
    symbols: activeScreen === 'symbols-list' || activeScreen === 'symbol-detail',
  }));

  // Auto-expand section if active screen changes from external source (e.g. Dashboard clicking)
  useEffect(() => {
    if (activeScreen === 'strategies-list' || activeScreen === 'strategy-detail') {
      setExpandedSections(prev => ({ ...prev, deployments: true }));
    } else if (activeScreen === 'strategy-templates') {
      setExpandedSections(prev => ({ ...prev, strategies: true }));
    } else if (activeScreen === 'accounts-list' || activeScreen === 'account-detail') {
      setExpandedSections(prev => ({ ...prev, accounts: true }));
    } else if (activeScreen === 'symbols-list' || activeScreen === 'symbol-detail') {
      setExpandedSections(prev => ({ ...prev, symbols: true }));
    }
  }, [activeScreen, selectedEntityId]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleNav = (screen: ViewScreen) => {
    onNavigate(screen);
    onClose(); // close on mobile after nav
  };

  const handleEntity = (type: 'account' | 'strategy' | 'symbol', id: string) => {
    onSelectEntity(type, id);
    onClose();
  };

  const filteredSymbols = symbols.filter(sym => 
    (sym.name || sym.ticker).toLowerCase().includes(symbolQuery.toLowerCase()) ||
    sym.ticker.toLowerCase().includes(symbolQuery.toLowerCase())
  );

  return (
    <>
      {/* Mobile backdrop overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        id="sidebar-container"
        className={`
          fixed lg:sticky top-0 left-0 z-40 h-screen h-[100dvh] max-h-[100dvh]
          w-72 lg:w-64
          bg-slate-950 border-r border-slate-800 text-slate-100
          flex flex-col justify-between font-sans shrink-0
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
      
        {/* Scrollable Upper Area */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          
          {/* Brand Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center font-bold text-white shrink-0">C</div>
              <div>
                <h1 className="text-sm font-bold tracking-tight text-white uppercase">CobraTrades</h1>
                <p className="text-[10px] text-slate-500 font-mono tracking-wide">ALGO AUDIT ENGINE</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[9px] bg-emerald-500/10 text-emerald-400 font-mono px-1.5 py-0.5 rounded border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
              {/* Mobile close button */}
              <button
                onClick={onClose}
                className="lg:hidden p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                aria-label="Close sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Global Navigation links */}
          <div className="px-4 py-4 space-y-1 shrink-0">
            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">Console Views</p>
            
            <button
              id="nav-dashboard-btn"
              onClick={() => handleNav('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'dashboard' 
                  ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Dashboard Overview</span>
            </button>

            <button
              id="nav-live-candlestick-btn"
              onClick={() => handleNav('live-candlestick')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'live-candlestick' 
                  ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <LineChart className="w-4 h-4 text-pink-400 shrink-0" />
              <span>Live Candlestick</span>
            </button>

            <button
              id="nav-transactions-btn"
              onClick={() => handleNav('transactions')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'transactions' 
                  ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <TableProperties className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Transactions Ledger</span>
            </button>

            <button
              id="nav-brokers-btn"
              onClick={() => handleNav('brokers-list')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'brokers-list' 
                  ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Globe className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Brokers Directory</span>
            </button>

            <button
              id="nav-analysis-btn"
              onClick={() => handleNav('deployment-analysis')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'deployment-analysis' 
                  ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <LineChart className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Deployment Analysis</span>
            </button>

            <button
              id="nav-volumes-btn"
              onClick={() => handleNav('volumes')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeScreen === 'volumes' 
                  ? 'bg-slate-900 text-white shadow-xs border-l-2 border-indigo-500 pl-2.5' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <HardDrive className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Docker Volumes</span>
            </button>
          </div>

          {/* Collapsible Accordion Groups */}
          <div className="px-4 py-2 space-y-2 flex-1">
            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 font-mono">Resources</p>
            
            {/* Deployments Group */}
            <div className="space-y-1">
              <button
                onClick={() => toggleSection('deployments')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeScreen === 'strategies-list' || activeScreen === 'strategy-detail'
                    ? 'text-indigo-450 bg-indigo-950/20 border-l-2 border-indigo-500 pl-2 font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-4 h-4 text-indigo-450 shrink-0" />
                  <span>Deployments ({activeStrategiesCount})</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${expandedSections.deployments ? 'rotate-180' : 'rotate-0'}`} />
              </button>
              
              <div 
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  expandedSections.deployments ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <div className="space-y-1 pl-3 py-1 border-l border-slate-800 ml-5">
                  <button
                    onClick={() => handleNav('strategies-list')}
                    className={`w-full text-left px-3 py-1.5 rounded text-[11px] transition-colors flex items-center gap-2 cursor-pointer ${
                      activeScreen === 'strategies-list'
                        ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2'
                        : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-650" />
                    <span>Overview</span>
                  </button>
                  
                  {strategies.filter(s => s.name.toLowerCase() !== 'manual').map(s => {
                    const isSelected = activeScreen === 'strategy-detail' && selectedEntityId === s.id;
                    return (
                      <button
                        key={s.id}
                        id={`sidebar-strat-${s.id}`}
                        onClick={() => handleEntity('strategy', s.id)}
                        className={`w-full text-left px-3 py-1.5 rounded text-[11px] truncate flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected 
                            ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2' 
                            : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                        }`}
                      >
                        <span className="truncate">{s.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-1.5 ${
                          s.status === 'active' ? 'bg-emerald-500' :
                          s.status === 'paused' ? 'bg-amber-500' : 'bg-slate-600'
                        }`} title={`Status: ${s.status}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Strategy Templates Group */}
            <div className="space-y-1">
              <button
                onClick={() => toggleSection('strategies')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeScreen === 'strategy-templates'
                    ? 'text-indigo-450 bg-indigo-950/20 border-l-2 border-indigo-500 pl-2 font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="w-4 h-4 text-indigo-455 shrink-0" />
                  <span>Strategy Templates ({visibleDefinitions.length})</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${expandedSections.strategies ? 'rotate-180' : 'rotate-0'}`} />
              </button>
              
              <div 
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  expandedSections.strategies ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <div className="space-y-1 pl-3 py-1 border-l border-slate-800 ml-5">
                  <button
                    onClick={() => handleNav('strategy-templates')}
                    className={`w-full text-left px-3 py-1.5 rounded text-[11px] transition-colors flex items-center gap-2 cursor-pointer ${
                      activeScreen === 'strategy-templates'
                        ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2'
                        : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-650" />
                    <span>Overview</span>
                  </button>
                  
                  {visibleDefinitions.map(s => {
                    return (
                      <button
                        key={s._id}
                        onClick={() => handleNav('strategy-templates')}
                        className="w-full text-left px-3 py-1.5 rounded text-[11px] truncate flex items-center justify-between transition-colors text-slate-400 hover:bg-slate-900/30 hover:text-slate-200 cursor-pointer"
                      >
                        <span className="truncate">{s.strategy_name}</span>
                        <span className="text-[9px] font-mono text-slate-600 shrink-0 ml-1.5">
                          {s.strategy_name.toLowerCase() === 'manual' ? 'SYS' : 'USR'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Accounts Group */}
            <div className="space-y-1">
              <button
                onClick={() => toggleSection('accounts')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeScreen === 'accounts-list' || activeScreen === 'account-detail'
                    ? 'text-indigo-455 bg-indigo-950/20 border-l-2 border-indigo-500 pl-2 font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Landmark className="w-4 h-4 text-indigo-455 shrink-0" />
                  <span>Accounts ({connectedAccountsCount})</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${expandedSections.accounts ? 'rotate-180' : 'rotate-0'}`} />
              </button>
              
              <div 
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  expandedSections.accounts ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <div className="space-y-1 pl-3 py-1 border-l border-slate-800 ml-5">
                  <button
                    onClick={() => handleNav('accounts-list')}
                    className={`w-full text-left px-3 py-1.5 rounded text-[11px] transition-colors flex items-center gap-2 cursor-pointer ${
                      activeScreen === 'accounts-list'
                        ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2'
                        : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-650" />
                    <span>Overview</span>
                  </button>
                  
                  {accounts.map(a => {
                    const isSelected = activeScreen === 'account-detail' && selectedEntityId === a.id;
                    return (
                      <button
                        key={a.id}
                        id={`sidebar-acc-${a.id}`}
                        onClick={() => handleEntity('account', a.id)}
                        className={`w-full text-left px-3 py-1.5 rounded text-[11px] truncate flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected 
                            ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2' 
                            : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                        }`}
                      >
                        <span className="truncate">{a.name}</span>
                        <span className={`text-[9px] font-mono shrink-0 ml-1.5 ${a.status === 'connected' ? 'text-emerald-500' : 'text-slate-650'}`}>
                          {a.status === 'connected' ? '●' : '○'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Tracked Symbols Group */}
            <div className="space-y-1">
              <button
                onClick={() => toggleSection('symbols')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeScreen === 'symbols-list' || activeScreen === 'symbol-detail'
                    ? 'text-indigo-455 bg-indigo-950/20 border-l-2 border-indigo-500 pl-2 font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <LineChart className="w-4 h-4 text-indigo-455 shrink-0" />
                  <span>Tracked Symbols ({symbols.length})</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${expandedSections.symbols ? 'rotate-180' : 'rotate-0'}`} />
              </button>
              
              <div 
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  expandedSections.symbols ? 'max-h-[1500px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <div className="pl-3 py-1 border-l border-slate-800 ml-5 space-y-1">
                  {symbols.length > 5 && (
                    <div className="relative mb-2 pr-1">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500 pointer-events-none" />
                      <input
                        type="text"
                        value={symbolQuery}
                        onChange={(e) => setSymbolQuery(e.target.value)}
                        placeholder="Search symbols..."
                        className="w-full pl-8 pr-6 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      {symbolQuery && (
                        <button
                          onClick={() => setSymbolQuery('')}
                          className="absolute right-2 top-1 text-slate-500 hover:text-slate-300 text-xs px-1"
                          title="Clear search"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-1 max-h-64 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                    <button
                      onClick={() => handleNav('symbols-list')}
                      className={`w-full text-left px-3 py-1.5 rounded text-[11px] transition-colors flex items-center gap-2 cursor-pointer ${
                        activeScreen === 'symbols-list'
                          ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2'
                          : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-655" />
                      <span>Overview</span>
                    </button>
                    
                    {filteredSymbols.map(sym => {
                      const isSelected = activeScreen === 'symbol-detail' && selectedEntityId === sym.ticker;
                      const isPositive = sym.change24h >= 0;
                      return (
                        <button
                          key={sym.ticker}
                          id={`sidebar-sym-${sym.ticker.replace('/', '-')}`}
                          onClick={() => handleEntity('symbol', sym.ticker)}
                          className={`w-full text-left px-3 py-1.5 rounded text-[11px] flex items-center justify-between transition-colors cursor-pointer ${
                            isSelected 
                              ? 'bg-slate-900 text-slate-100 font-bold border-l-2 border-indigo-500 pl-2' 
                              : 'text-slate-400 hover:bg-slate-900/30 hover:text-slate-200'
                          }`}
                        >
                          <span className="truncate font-sans font-medium" title={sym.name || sym.ticker}>
                            {sym.name || sym.ticker}
                          </span>
                          <span className={`shrink-0 ml-1.5 text-[9px] font-mono ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {isPositive ? '+' : ''}{sym.change24h}%
                          </span>
                        </button>
                      );
                    })}

                    {filteredSymbols.length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-slate-500 italic">
                        No symbols match "{symbolQuery}"
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer System Panel */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 shrink-0">
          
          {/* Timezone Switcher Selector */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs mb-3">
            <div className="flex items-center gap-1.5 text-slate-400 font-mono">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Timezone</span>
            </div>
            <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800">
              <button
                onClick={() => onTimezoneChange('UTC')}
                className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold transition-all cursor-pointer ${
                  timezone === 'UTC' 
                    ? 'bg-indigo-600 text-white' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                UTC
              </button>
              <button
                onClick={() => onTimezoneChange('Local')}
                className={`px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold transition-all cursor-pointer ${
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
            onClick={() => handleNav('profile')}
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
            <div className="truncate flex-1 min-w-0">
              <h4 className="text-xs font-bold text-slate-200 truncate">{currentUser?.name || 'Prabu Selvam'}</h4>
              <p className="text-[10px] text-slate-500 truncate font-mono">{currentUser?.email || 'prabuselvamonline@gmail.com'}</p>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
}
