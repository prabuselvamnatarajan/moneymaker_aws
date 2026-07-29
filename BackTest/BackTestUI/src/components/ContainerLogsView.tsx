/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { HardDrive, Terminal, RefreshCw, Play, Square } from 'lucide-react';
import { useToast } from './Toast';

interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  state: string;
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
  const { showError } = useToast();
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [tailLines, setTailLines] = useState(200);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filterLevel, setFilterLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all');

  // Fetch containers list
  const loadContainers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/backtestapp/docker/containers', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load containers: ${response.status}`);
      }
      
      const data = await response.json();
      setContainers(data.items || []);
      
      // Auto-select first container if none selected
      if (!selectedContainer && data.items && data.items.length > 0) {
        setSelectedContainer(data.items[0]);
      }
    } catch (err: any) {
      showError(err.message || 'Failed to load containers');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch logs for selected container
  const loadLogs = async (containerId: string) => {
    setIsLogsLoading(true);
    try {
      const params = new URLSearchParams({
        tail: String(tailLines),
        timestamps: String(showTimestamps),
      });
      
      const response = await fetch(`/backtestapp/docker/containers/${encodeURIComponent(containerId)}/logs?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.status}`);
      }
      
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (err: any) {
      showError(err.message || 'Failed to load logs');
    } finally {
      setIsLogsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadContainers();
  }, []);

  // Load logs when container selected or options change
  useEffect(() => {
    if (selectedContainer) {
      loadLogs(selectedContainer.id);
    }
  }, [selectedContainer, tailLines, showTimestamps]);

  // Auto-refresh logs
  useEffect(() => {
    if (!autoRefresh || !selectedContainer) return;
    
    const interval = setInterval(() => {
      loadLogs(selectedContainer.id);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, selectedContainer, tailLines, showTimestamps]);

  // Filter logs by level
  const filteredLogs = logs.filter(log => {
    if (filterLevel === 'all') return true;
    return log.level === filterLevel;
  });

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-400 bg-red-950/30 border-red-900/50';
      case 'warn': return 'text-amber-400 bg-amber-950/30 border-amber-900/50';
      case 'debug': return 'text-gray-400 bg-gray-950/30 border-gray-900/50';
      case 'info': return 'text-blue-400 bg-blue-950/30 border-blue-900/50';
      default: return 'text-slate-300 bg-slate-950/30 border-slate-900/50';
    }
  };

  const getContainerStatusColor = (status: string) => {
    if (status.toLowerCase().includes('running')) return 'bg-emerald-500';
    if (status.toLowerCase().includes('paused')) return 'bg-amber-500';
    return 'bg-slate-500';
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Container Logs</h1>
            <p className="text-xs text-slate-500">View and monitor Docker container logs</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={loadContainers}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Container List */}
        <div className="w-80 border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-800">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <HardDrive className="w-4 h-4" />
              Containers ({containers.length})
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {containers.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                No containers found
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {containers.map(container => (
                  <button
                    key={container.id}
                    onClick={() => setSelectedContainer(container)}
                    className={`w-full text-left p-4 hover:bg-slate-900/50 transition-colors ${
                      selectedContainer?.id === container.id ? 'bg-slate-900 border-l-2 border-indigo-500 pl-3' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-2 h-2 rounded-full ${getContainerStatusColor(container.status)}`} />
                          <span className="text-sm font-semibold text-white truncate">{container.name}</span>
                        </div>
                        <p className="text-xs text-slate-500 truncate">{container.image}</p>
                        <p className="text-[10px] text-slate-600 mt-1 font-mono">{container.status}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Content - Logs Viewer */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedContainer ? (
            <>
              {/* Toolbar */}
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-400">Lines:</label>
                    <select
                      value={tailLines}
                      onChange={(e) => setTailLines(Number(e.target.value))}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                    </select>
                  </div>
                  
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showTimestamps}
                      onChange={(e) => setShowTimestamps(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500/20"
                    />
                    <span className="text-xs text-slate-400">Timestamps</span>
                  </label>
                  
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500/20"
                    />
                    <span className="text-xs text-slate-400">Auto-refresh (5s)</span>
                  </label>
                </div>
                
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400">Filter:</label>
                  <select
                    value={filterLevel}
                    onChange={(e) => setFilterLevel(e.target.value as any)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All Levels</option>
                    <option value="error">Errors Only</option>
                    <option value="warn">Warnings</option>
                    <option value="info">Info</option>
                  </select>
                  
                  <button
                    onClick={() => loadLogs(selectedContainer.id)}
                    disabled={isLogsLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {isLogsLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Load Logs
                  </button>
                </div>
              </div>

              {/* Logs Display */}
              <div className="flex-1 overflow-y-auto bg-slate-900/50 p-4 font-mono text-xs">
                {isLogsLoading && logs.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-3" />
                      <p className="text-slate-400">Loading logs...</p>
                    </div>
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Terminal className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                      <p className="text-slate-500">No logs to display</p>
                      {filterLevel !== 'all' && (
                        <p className="text-slate-600 text-xs mt-1">Try changing the filter level</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {filteredLogs.map((log, index) => (
                      <div
                        key={index}
                        className={`px-3 py-1.5 rounded border ${getLogLevelColor(log.level)} hover:bg-slate-800/50 transition-colors`}
                      >
                        <div className="flex items-start gap-3">
                          {showTimestamps && (
                            <span className="text-[10px] text-slate-500 shrink-0 whitespace-nowrap">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          )}
                          <span className={`text-[10px] uppercase font-bold w-12 shrink-0 ${
                            log.level === 'error' ? 'text-red-400' :
                            log.level === 'warn' ? 'text-amber-400' :
                            log.level === 'debug' ? 'text-gray-400' :
                            log.level === 'info' ? 'text-blue-400' :
                            'text-slate-400'
                          }`}>
                            {log.level}
                          </span>
                          <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <HardDrive className="w-16 h-16 text-slate-700 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-400 mb-2">No Container Selected</h3>
                <p className="text-slate-500 text-sm">Select a container from the sidebar to view its logs</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
