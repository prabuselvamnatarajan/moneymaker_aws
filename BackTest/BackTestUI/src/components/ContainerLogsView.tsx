/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, HardDrive, RefreshCw, Play, Search, Download, 
  Copy, ArrowDown, Check, Filter, Layers, Menu, X, ShieldAlert 
} from 'lucide-react';
import { useToast } from './Toast';
import { api } from '../api';

interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  state: string;
  createdAt?: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'log';
}

interface ContainerLogsViewProps {
  currentUser: { _id: string; username: string; email: string; name: string; is_mfa_enabled: boolean; roles?: any[] } | null;
}

export default function ContainerLogsView({ currentUser }: ContainerLogsViewProps) {
  const { showError, showSuccess } = useToast();

  // Mobile drawer state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Container list state
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);
  const [isLoadingContainers, setIsLoadingContainers] = useState(false);
  const [containerSearch, setContainerSearch] = useState('');
  const [showAllContainers, setShowAllContainers] = useState(false);
  const [scope, setScope] = useState<'app' | 'all'>('app');

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [tailLines, setTailLines] = useState(200);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(5); // 0 = off, 2, 5, 10
  const [logFilterLevel, setLogFilterLevel] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Admin access check
  const isAdminUser = currentUser?.roles?.some((role: any) => 
    (typeof role === 'string' && role === 'admin') || 
    (typeof role === 'object' && role?.name === 'admin')
  ) ?? false;

  // Load containers from API
  const loadContainers = async () => {
    setIsLoadingContainers(true);
    try {
      const res = await api.docker.listContainers({ all: showAllContainers, scope });
      const fetchedItems: Container[] = res.items || [];
      setContainers(fetchedItems);

      // Auto-select first container if none selected or current selection missing
      if (fetchedItems.length > 0) {
        if (!selectedContainer || !fetchedItems.some(c => c.id === selectedContainer.id)) {
          setSelectedContainer(fetchedItems[0]);
        }
      } else {
        setSelectedContainer(null);
      }
    } catch (err: any) {
      showError(err.message || 'Failed to fetch Docker containers');
    } finally {
      setIsLoadingContainers(false);
    }
  };

  // Load logs for selected container
  const loadLogs = async (containerId: string) => {
    setIsLogsLoading(true);
    try {
      const res = await api.docker.getContainerLogs(containerId, {
        tail: tailLines,
        timestamps: showTimestamps,
      });
      setLogs(res.logs || []);
    } catch (err: any) {
      showError(err.message || 'Failed to fetch container logs');
    } finally {
      setIsLogsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (isAdminUser) {
      loadContainers();
    }
  }, [showAllContainers, scope]);

  // Load logs on selection or parameter change
  useEffect(() => {
    if (selectedContainer) {
      loadLogs(selectedContainer.id);
    }
  }, [selectedContainer?.id, tailLines, showTimestamps]);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefreshInterval || autoRefreshInterval <= 0 || !selectedContainer) return;

    const interval = setInterval(() => {
      loadLogs(selectedContainer.id);
    }, autoRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefreshInterval, selectedContainer?.id, tailLines, showTimestamps]);

  // Auto-scroll effect when logs update
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, logFilterLevel, logSearchQuery]);

  // Filter containers by search query
  const filteredContainers = containers.filter(c => 
    c.name.toLowerCase().includes(containerSearch.toLowerCase()) ||
    c.image.toLowerCase().includes(containerSearch.toLowerCase()) ||
    c.id.toLowerCase().includes(containerSearch.toLowerCase())
  );

  // Compute log statistics
  const levelCounts = {
    all: logs.length,
    error: logs.filter(l => l.level === 'error').length,
    warn: logs.filter(l => l.level === 'warn').length,
    info: logs.filter(l => l.level === 'info').length,
    debug: logs.filter(l => l.level === 'debug').length,
  };

  // Filter logs by level and search text
  const filteredLogs = logs.filter(log => {
    const matchesLevel = logFilterLevel === 'all' || log.level === logFilterLevel;
    const matchesSearch = !logSearchQuery || log.message.toLowerCase().includes(logSearchQuery.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  // Action: Copy logs to clipboard
  const handleCopyLogs = () => {
    const textToCopy = filteredLogs
      .map(l => `${showTimestamps ? `[${l.timestamp}] ` : ''}[${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    showSuccess('Logs copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  // Action: Download logs as file
  const handleDownloadLogs = () => {
    if (!selectedContainer) return;
    const textContent = filteredLogs
      .map(l => `${showTimestamps ? `[${l.timestamp}] ` : ''}[${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `container-${selectedContainer.name}-${new Date().toISOString().replace(/:/g, '-')}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showSuccess('Log file download started');
  };

  // Render status badge color
  const getStatusBadge = (status: string, state: string) => {
    const isRunning = state === 'running' || status.toLowerCase().includes('up');
    const isExited = state === 'exited' || status.toLowerCase().includes('exited');
    
    if (isRunning) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Running
        </span>
      );
    }
    if (isExited) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono text-rose-400 font-medium">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          Exited
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 font-medium">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        {state || 'Paused'}
      </span>
    );
  };

  const getLogLevelStyle = (level: string) => {
    switch (level) {
      case 'error': return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'warn': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'info': return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
      case 'debug': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      default: return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  // Access check fallback for non-admin users
  if (!isAdminUser) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4 my-12">
        <div className="w-12 h-12 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto border border-rose-500/20">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Access Restricted</h2>
        <p className="text-sm text-slate-400">
          Docker Container Logs viewing is restricted to administrative accounts only.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* Top Header */}
      <header className="px-4 lg:px-6 py-3 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/40 backdrop-blur">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)} 
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 border border-slate-700"
            aria-label="Toggle container menu"
          >
            {mobileDrawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              Docker Container Logs
              <span className="text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                ADMIN CONSOLE
              </span>
            </h1>
            <p className="text-xs text-slate-400 hidden sm:block">Monitor real-time outputs for MoneyMaker application microservices & host containers</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadContainers}
            disabled={isLoadingContainers}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh containers list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingContainers ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh Stack</span>
          </button>
        </div>
      </header>

      {/* Main Body - Split Layout */}
      <div className="flex-1 flex min-h-0 relative">

        {/* Sidebar Container Drawer / Column */}
        <aside className={`
          fixed lg:relative top-0 left-0 z-30 h-full w-80 bg-slate-950 border-r border-slate-800 
          flex flex-col shrink-0 transition-transform duration-300 ease-in-out
          ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          
          {/* Filter Options */}
          <div className="p-3 border-b border-slate-800 space-y-2 bg-slate-900/30">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search container name/image..."
                value={containerSearch}
                onChange={(e) => setContainerSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              {containerSearch && (
                <button onClick={() => setContainerSearch('')} className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Scope Switcher & Show All Toggle */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex bg-slate-900 rounded-md p-0.5 border border-slate-800 shrink-0">
                <button
                  onClick={() => setScope('app')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    scope === 'app' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  App Stack
                </button>
                <button
                  onClick={() => setScope('all')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    scope === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Host
                </button>
              </div>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showAllContainers}
                  onChange={(e) => setShowAllContainers(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-900 text-indigo-500 focus:ring-0"
                />
                Show Stopped
              </label>
            </div>
          </div>

          {/* Container List Header */}
          <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
              Containers ({filteredContainers.length})
            </span>
          </div>

          {/* Scrollable Container List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-900/80 scrollbar-thin scrollbar-thumb-slate-800">
            {isLoadingContainers && containers.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                Scanning host containers...
              </div>
            ) : filteredContainers.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                No containers found matching filter.
              </div>
            ) : (
              filteredContainers.map((container) => {
                const isSelected = selectedContainer?.id === container.id;
                return (
                  <button
                    key={container.id}
                    onClick={() => {
                      setSelectedContainer(container);
                      setMobileDrawerOpen(false);
                    }}
                    className={`w-full text-left p-3.5 transition-all cursor-pointer border-l-2 ${
                      isSelected 
                        ? 'bg-slate-900/90 border-indigo-500 shadow-sm' 
                        : 'border-transparent hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-xs text-white truncate font-mono">{container.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate font-mono">{container.image}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {getStatusBadge(container.status, container.state)}
                          <span className="text-[9px] text-slate-600 font-mono truncate max-w-[120px]">{container.id.slice(0, 12)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main Log Terminal Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
          
          {selectedContainer ? (
            <>
              {/* Selected Container Subheader & Search Bar */}
              <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-white font-mono truncate">{selectedContainer.name}</h2>
                      <span className="text-[10px] text-slate-500 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                        {selectedContainer.id.slice(0, 12)}
                      </span>
                      {getStatusBadge(selectedContainer.status, selectedContainer.state)}
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{selectedContainer.image}</p>
                  </div>
                </div>

                {/* Log Text Search Input */}
                <div className="relative min-w-[200px] max-w-[320px] flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search logs keyword..."
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md pl-8 pr-8 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  {logSearchQuery && (
                    <button onClick={() => setLogSearchQuery('')} className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Log Toolbar / Control Panel */}
              <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/50 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
                
                {/* Level Tabs */}
                <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                  <button
                    onClick={() => setLogFilterLevel('all')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                      logFilterLevel === 'all' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All <span className="text-[10px] opacity-70">({levelCounts.all})</span>
                  </button>
                  <button
                    onClick={() => setLogFilterLevel('error')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                      logFilterLevel === 'error' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-rose-400'
                    }`}
                  >
                    Errors <span className="text-[10px] px-1.5 py-0.2 bg-rose-500/20 rounded-full">{levelCounts.error}</span>
                  </button>
                  <button
                    onClick={() => setLogFilterLevel('warn')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                      logFilterLevel === 'warn' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-400 hover:text-amber-400'
                    }`}
                  >
                    Warnings <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 rounded-full">{levelCounts.warn}</span>
                  </button>
                  <button
                    onClick={() => setLogFilterLevel('info')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                      logFilterLevel === 'info' ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : 'text-slate-400 hover:text-sky-400'
                    }`}
                  >
                    Info <span className="text-[10px] opacity-70">({levelCounts.info})</span>
                  </button>
                  <button
                    onClick={() => setLogFilterLevel('debug')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                      logFilterLevel === 'debug' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'text-slate-400 hover:text-purple-400'
                    }`}
                  >
                    Debug <span className="text-[10px] opacity-70">({levelCounts.debug})</span>
                  </button>
                </div>

                {/* Display & Refresh Controls */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Tail:</span>
                    <select
                      value={tailLines}
                      onChange={(e) => setTailLines(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value={50}>50 lines</option>
                      <option value={100}>100 lines</option>
                      <option value={200}>200 lines</option>
                      <option value={500}>500 lines</option>
                      <option value={1000}>1000 lines</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showTimestamps}
                      onChange={(e) => setShowTimestamps(e.target.checked)}
                      className="rounded border-slate-800 bg-slate-900 text-indigo-500 focus:ring-0"
                    />
                    Timestamps
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Auto-refresh:</span>
                    <select
                      value={autoRefreshInterval}
                      onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value={0}>Off</option>
                      <option value={2}>2s</option>
                      <option value={5}>5s</option>
                      <option value={10}>10s</option>
                    </select>
                  </div>

                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`p-1.5 rounded border text-xs transition-colors cursor-pointer ${
                      autoScroll ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-400' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title="Toggle auto-scroll to bottom"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={handleCopyLogs}
                    className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    title="Copy logs to clipboard"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={handleDownloadLogs}
                    className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    title="Download log file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => loadLogs(selectedContainer.id)}
                    disabled={isLogsLoading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLogsLoading ? 'animate-spin' : ''}`} />
                    <span className="hidden md:inline">Refresh</span>
                  </button>
                </div>
              </div>

              {/* Logs Content Window */}
              <div 
                ref={logContainerRef}
                className="flex-1 overflow-y-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed selection:bg-indigo-500/30 scrollbar-thin scrollbar-thumb-slate-800"
              >
                {isLogsLoading && logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mb-3" />
                    <p className="text-sm">Fetching container output logs...</p>
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                    <Terminal className="w-10 h-10 text-slate-700" />
                    <p className="text-sm font-medium">No logs match the current query or filter level.</p>
                    {logSearchQuery && (
                      <button 
                        onClick={() => setLogSearchQuery('')}
                        className="text-xs text-indigo-400 hover:underline cursor-pointer"
                      >
                        Clear search string
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {filteredLogs.map((log, index) => {
                      const levelStyle = getLogLevelStyle(log.level);
                      return (
                        <div 
                          key={index} 
                          className="group flex items-start gap-2 hover:bg-slate-900/60 rounded px-2 py-1 transition-colors border-l-2 border-transparent hover:border-indigo-500/50"
                        >
                          {/* Line Number */}
                          <span className="text-[10px] text-slate-600 select-none w-10 text-right shrink-0 font-mono">
                            {index + 1}
                          </span>

                          {/* Optional Timestamp */}
                          {showTimestamps && (
                            <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                          )}

                          {/* Log Level Pill */}
                          <span className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded border shrink-0 font-mono ${levelStyle}`}>
                            {log.level}
                          </span>

                          {/* Message Body */}
                          <span className="break-all whitespace-pre-wrap flex-1 text-slate-300 group-hover:text-slate-100">
                            {log.message}
                          </span>
                        </div>
                      );
                    })}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center">
              <HardDrive className="w-16 h-16 text-slate-800 mb-4" />
              <h3 className="text-base font-bold text-slate-300 mb-1">No Container Selected</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Select a container microservice from the sidebar stack to begin monitoring live stdout & stderr log streams.
              </p>
            </div>
          )}
        </main>

      </div>
    </div>
  );
}
