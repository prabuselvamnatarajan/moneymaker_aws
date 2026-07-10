/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Eye, Flag, 
  Settings, CheckSquare, Square, Download, Trash, RefreshCw, Layers, SlidersHorizontal, ListCollapse,
  GripVertical, Play, Plus, X
} from 'lucide-react';
import { Transaction, Account, Strategy, ColumnPreference } from '../types';

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  strategies: Strategy[];
  variant: 'compact' | 'full';
  onRowClick: (tx: Transaction) => void;
  // If in compact mode, views all transactions filtered by this entity
  onViewAllDrilldown?: () => void;
  highlightedTxId?: string;
  timezone: string;
  // Server-side multi-level sort support
  sortConfigs?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  onSortChange?: (configs: Array<{ field: string; direction: 'asc' | 'desc' }>) => void;
  // Lifted up column state for server-side projection
  columns?: ColumnPreference[];
  onColumnsChange?: (cols: ColumnPreference[]) => void;
}

const DEFAULT_COLUMNS: ColumnPreference[] = [
  { id: 'timestamp', label: 'Timestamp', visible: true },
  { id: 'type', label: 'Type', visible: true },
  { id: 'symbol', label: 'Symbol', visible: true },
  { id: 'strategy', label: 'Strategy', visible: true },
  { id: 'account', label: 'Account', visible: true },
  { id: 'quantity', label: 'Quantity', visible: true },
  { id: 'price', label: 'Price', visible: true },
  { id: 'fee', label: 'Fee', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'tradeId', label: 'Trade / Execution ID', visible: true },
];

export default function TransactionList({
  transactions,
  accounts,
  strategies,
  variant,
  onRowClick,
  onViewAllDrilldown,
  highlightedTxId,
  timezone,
  sortConfigs,
  onSortChange,
  columns,
  onColumnsChange,
}: TransactionListProps) {
  // Use lifted up columns/callback if present; fall back to local state
  const [localColumns, setLocalColumns] = useState<ColumnPreference[]>(DEFAULT_COLUMNS);
  const activeColumns = columns || localColumns;
  const setActiveColumns = onColumnsChange || setLocalColumns;

  const [showColumnChooser, setShowColumnChooser] = useState(false);
  const [showSortManager, setShowSortManager] = useState(false);
  const [tempSortConfigs, setTempSortConfigs] = useState<Array<{ field: string; direction: 'asc' | 'desc' }>>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Sync tempSortConfigs with sortConfigs when the popover opens
  useEffect(() => {
    if (showSortManager && sortConfigs) {
      setTempSortConfigs(sortConfigs);
    }
  }, [showSortManager, sortConfigs]);

  // --- Column Chooser drag and drop state & handlers ---
  const [tempColumns, setTempColumns] = useState<ColumnPreference[]>([]);
  const [draggedColId, setDraggedColId] = useState<string | null>(null);

  // Sync tempColumns with activeColumns when the popover opens
  useEffect(() => {
    if (showColumnChooser) {
      setTempColumns(activeColumns);
    }
  }, [showColumnChooser, activeColumns]);

  const handleColDragStart = (e: React.DragEvent, id: string) => {
    setDraggedColId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleColDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnSelected = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!draggedColId) return;

    const draggedCol = tempColumns.find(c => c.id === draggedColId);
    if (!draggedCol) return;

    // Filter out the dragged column
    const updated = tempColumns.filter(c => c.id !== draggedColId);
    const updatedCol = { ...draggedCol, visible: true };

    // Get visible columns in the updated array
    let targetAbsoluteIndex = 0;
    let visibleCount = 0;
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].visible) {
        if (visibleCount === targetIndex) {
          targetAbsoluteIndex = i;
          break;
        }
        visibleCount++;
      }
    }

    if (targetIndex >= visibleCount) {
      updated.push(updatedCol);
    } else {
      updated.splice(targetAbsoluteIndex, 0, updatedCol);
    }

    setTempColumns(updated);
    setDraggedColId(null);
  };

  const handleDropOnSelectedContainer = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedColId) return;

    const draggedCol = tempColumns.find(c => c.id === draggedColId);
    if (!draggedCol || draggedCol.visible) return; // If already visible, internal drop handles reordering

    const updated = tempColumns.map(c => 
      c.id === draggedColId ? { ...c, visible: true } : c
    );
    setTempColumns(updated);
    setDraggedColId(null);
  };

  const handleDropOnAvailableContainer = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedColId) return;

    // Prevent hiding all columns
    const visibleCount = tempColumns.filter(c => c.visible).length;
    if (visibleCount <= 1) {
      setDraggedColId(null);
      return;
    }

    const updated = tempColumns.map(c => 
      c.id === draggedColId ? { ...c, visible: false } : c
    );
    setTempColumns(updated);
    setDraggedColId(null);
  };

  // Button move operations (fallback / accessibility click support)
  const moveToSelected = (id: string) => {
    setTempColumns(prev => prev.map(c => 
      c.id === id ? { ...c, visible: true } : c
    ));
  };

  const moveToAvailable = (id: string) => {
    // Prevent hiding all columns
    const visibleCount = tempColumns.filter(c => c.visible).length;
    if (visibleCount <= 1) return;

    setTempColumns(prev => prev.map(c => 
      c.id === id ? { ...c, visible: false } : c
    ));
  };

  const handleApplyColumns = () => {
    setActiveColumns(tempColumns);
    setShowColumnChooser(false);
  };

  // --- Sort Manager Helpers (modifying local tempSortConfigs state) ---
  const handleToggleSortDir = (field: string) => {
    setTempSortConfigs(prev =>
      prev.map(c => c.field === field ? { ...c, direction: c.direction === 'asc' ? 'desc' : 'asc' } : c)
    );
  };

  const handleMoveSort = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < tempSortConfigs.length) {
      const updated = [...tempSortConfigs];
      const temp = updated[index];
      updated[index] = updated[targetIndex];
      updated[targetIndex] = temp;
      setTempSortConfigs(updated);
    }
  };

  const handleRemoveSort = (field: string) => {
    setTempSortConfigs(prev => prev.filter(c => c.field !== field));
  };

  const handleAddSort = (field: string) => {
    if (!tempSortConfigs.some(c => c.field === field)) {
      setTempSortConfigs(prev => [...prev, { field, direction: 'asc' }]);
    }
  };

  const handleApplySort = () => {
    if (onSortChange) {
      onSortChange(tempSortConfigs);
    }
    setShowSortManager(false);
  };

  // --- Drag and Drop Sorting Handlers ---
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const updated = [...tempSortConfigs];
    const draggedItem = updated[draggedIndex];
    updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedItem);
    
    setTempSortConfigs(updated);
    setDraggedIndex(null);
  };

  // --- Sorting State ---
  const [sortField, setSortField] = useState<keyof Transaction | 'strategy' | 'account' | null>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // --- Pagination State ---
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(variant === 'compact' ? 5 : 20);

  // --- Bulk Selection State ---
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Helpers to fetch linked names
  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || id;
  const getStrategyName = (id: string) => strategies.find(s => s.id === id)?.name || id;

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        timeZone: timezone === 'UTC' ? 'UTC' : undefined,
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (e) {
      return isoString;
    }
  };

  // --- Sorting & Filtering Logic ---
  const handleSort = (field: string, event: React.MouseEvent) => {
    if (variant === 'compact') return; // Compact view is always sorted by time

    if (onSortChange && sortConfigs) {
      let newConfigs = [...sortConfigs];
      const isShiftPressed = event.shiftKey;

      const existingIdx = newConfigs.findIndex(c => c.field === field);
      if (existingIdx > -1) {
        const currentDir = newConfigs[existingIdx].direction;
        if (currentDir === 'asc') {
          newConfigs[existingIdx].direction = 'desc';
        } else {
          newConfigs.splice(existingIdx, 1);
        }
      } else {
        if (isShiftPressed) {
          newConfigs.push({ field, direction: 'asc' });
        } else {
          newConfigs = [{ field, direction: 'asc' }];
        }
      }
      onSortChange(newConfigs);
    } else {
      if (sortField === field) {
        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField(field as any);
        setSortDirection('desc');
      }
    }
    setCurrentPage(1);
  };

  const sortedTransactions = useMemo(() => {
    const list = [...transactions];
    if (sortConfigs) {
      // Server-side sorted already!
      return list;
    }
    if (!sortField) return list;

    list.sort((a, b) => {
      let aVal: any = a[sortField as keyof Transaction] ?? '';
      let bVal: any = b[sortField as keyof Transaction] ?? '';

      if (sortField === 'strategy') {
        aVal = getStrategyName(a.strategyId);
        bVal = getStrategyName(b.strategyId);
      } else if (sortField === 'account') {
        aVal = getAccountName(a.accountId);
        bVal = getAccountName(b.accountId);
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      } else {
        return sortDirection === 'asc'
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      }
    });

    return list;
  }, [transactions, sortField, sortDirection, sortConfigs]);

  // --- Compact limits vs. Paginated lists ---
  const paginatedTransactions = useMemo(() => {
    if (variant === 'compact') {
      return sortedTransactions.slice(0, pageSize);
    }
    const startIndex = (currentPage - 1) * pageSize;
    return sortedTransactions.slice(startIndex, startIndex + pageSize);
  }, [sortedTransactions, variant, currentPage, pageSize]);

  const totalPages = Math.ceil(transactions.length / pageSize);



  // --- Bulk Selection Operations ---
  const handleSelectAll = () => {
    const pageIds = paginatedTransactions.map(t => t.id);
    const allSelected = pageIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent opening details
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // --- Export Handlers ---
  const exportCSV = () => {
    const targetList = selectedIds.length > 0 
      ? transactions.filter(t => selectedIds.includes(t.id))
      : transactions;

    const headers = ['TXID', 'Timestamp', 'Type', 'Symbol', 'Strategy', 'Account', 'Quantity', 'Price', 'Fee', 'Status', 'TradeID'];
    const rows = targetList.map(t => [
      t.id,
      t.timestamp,
      t.type,
      t.symbol,
      getStrategyName(t.strategyId),
      getAccountName(t.accountId),
      t.quantity,
      t.price,
      t.fee,
      t.status,
      t.tradeId
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `cobratrades-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    const targetList = selectedIds.length > 0 
      ? transactions.filter(t => selectedIds.includes(t.id))
      : transactions;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(targetList, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href",     dataStr);
    downloadAnchor.setAttribute("download", `cobratrades-transactions-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Floating Bar for bulk operations
  const renderBulkActionBar = () => {
    if (selectedIds.length === 0 || variant === 'compact') return null;
    return (
      <div className="flex items-center justify-between bg-slate-950 border border-indigo-500/30 px-4 py-3 rounded-lg shadow-xl text-xs font-medium text-slate-200">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          <span>Selected <strong className="text-white font-mono">{selectedIds.length}</strong> transactions</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCSV}
            className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> CSV Export
          </button>
          <button
            onClick={exportJSON}
            className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> JSON Export
          </button>
          <button
            onClick={() => setSelectedIds([])}
            className="text-slate-500 hover:text-slate-300 px-2 py-1.5"
          >
            Clear
          </button>
        </div>
      </div>
    );
  };

  const visibleColumns = activeColumns.filter(c => c.visible);

  return (
    <div className="space-y-4">
      
      {/* List Toolbar / Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-200 font-sans tracking-tight">
            {variant === 'compact' ? 'Recent Transactions Ledger' : 'Auditable Records'}
            {variant === 'compact' && (
              <span className="text-xs font-normal text-slate-500 ml-2 font-mono">
                (Showing latest {paginatedTransactions.length})
              </span>
            )}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {variant === 'compact' && onViewAllDrilldown && (
            <button
              id="view-all-transactions-drilldown"
              onClick={onViewAllDrilldown}
              className="px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 hover:bg-slate-800 text-indigo-400 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              View All Transactions <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          {variant === 'full' && (
            <div className="flex items-center gap-2">
              {/* Sort Manager Button & Popover */}
              {sortConfigs && onSortChange && (
                <div className="relative">
                  <button
                    id="sort-manager-toggle"
                    onClick={() => {
                      setShowSortManager(!showSortManager);
                      setShowColumnChooser(false);
                    }}
                    className={`p-2 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      showSortManager 
                        ? 'bg-slate-800 text-indigo-400 border-slate-700' 
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                    title="Configure Multi-Level Sorting"
                  >
                    <ArrowUpDown className="w-4 h-4" />
                    <span className="hidden sm:inline">Sort Hierarchy</span>
                    {sortConfigs.length > 0 && (
                      <span className="bg-indigo-500 text-white font-mono font-bold text-[9px] px-1.5 py-0.5 rounded-full">
                        {sortConfigs.length}
                      </span>
                    )}
                  </button>

                  {/* Sort Manager Dropdown Panel */}
                  {showSortManager && (
                    <div id="sort-manager-panel" className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-4 z-40 animate-in fade-in duration-100 divide-y divide-slate-800/65">
                      <div className="pb-2.5 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-200 tracking-wide flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" /> Sort Priority Ranking
                        </span>
                        <button 
                          onClick={() => setShowSortManager(false)} 
                          className="text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                        >
                          Done
                        </button>
                      </div>

                      <div className="py-2.5 space-y-2">
                        {tempSortConfigs.length === 0 ? (
                          <div className="text-center py-4 text-xs text-slate-500 italic">
                            No sorting applied. Table defaults to server order.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {tempSortConfigs.map((cfg, idx) => {
                              const colLabel = activeColumns.find(c => c.id === cfg.field)?.label || cfg.field;
                              return (
                                <div 
                                  key={cfg.field} 
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, idx)}
                                  onDragOver={(e) => handleDragOver(e, idx)}
                                  onDrop={(e) => handleDrop(e, idx)}
                                  className={`flex items-center justify-between bg-slate-950 p-2 rounded-md border text-xs transition-all ${
                                    draggedIndex === idx 
                                      ? 'border-indigo-500/50 bg-slate-900/50 opacity-50' 
                                      : 'border-slate-800 hover:border-slate-700 bg-slate-950'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {/* Drag Handle */}
                                    <div className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 p-0.5">
                                      <GripVertical className="w-3.5 h-3.5" />
                                    </div>
                                    <span className="font-mono text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-sm font-bold">
                                      {idx + 1}
                                    </span>
                                    <span className="text-slate-200 font-semibold truncate max-w-[85px]" title={colLabel}>
                                      {colLabel}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    {/* Toggle Order (Asc / Desc) */}
                                    <button
                                      onClick={() => handleToggleSortDir(cfg.field)}
                                      className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 hover:bg-slate-850 text-[10px] font-mono font-bold text-indigo-400 cursor-pointer"
                                      title="Toggle Sort Direction"
                                    >
                                      {cfg.direction.toUpperCase()}
                                    </button>

                                    {/* Move Up / Down */}
                                    <button
                                      disabled={idx === 0}
                                      onClick={() => handleMoveSort(idx, 'up')}
                                      className="p-1 rounded bg-slate-900 border border-slate-850 hover:bg-slate-800 disabled:opacity-20 text-slate-400 hover:text-white cursor-pointer"
                                      title="Increase Priority"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      disabled={idx === tempSortConfigs.length - 1}
                                      onClick={() => handleMoveSort(idx, 'down')}
                                      className="p-1 rounded bg-slate-900 border border-slate-850 hover:bg-slate-800 disabled:opacity-20 text-slate-400 hover:text-white cursor-pointer"
                                      title="Decrease Priority"
                                    >
                                      ▼
                                    </button>

                                    {/* Remove */}
                                    <button
                                      onClick={() => handleRemoveSort(cfg.field)}
                                      className="p-1 rounded bg-rose-950/20 hover:bg-rose-950 text-rose-400 cursor-pointer"
                                      title="Remove sort"
                                    >
                                      <Trash className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Add Column Dropdown */}
                      <div className="py-2.5 flex items-center justify-between gap-2">
                        <select
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              handleAddSort(val);
                              e.target.value = '';
                            }
                          }}
                          className="bg-slate-955 border border-slate-800 text-slate-300 text-[11px] rounded px-2 py-1 outline-hidden focus:border-indigo-500 w-full cursor-pointer"
                        >
                          <option value="">+ Add Sort Priority</option>
                          {activeColumns
                            .filter(col => {
                              const colId = col.id === 'strategy' ? 'strategy' : col.id === 'account' ? 'account' : col.id;
                              return !tempSortConfigs.some(cfg => cfg.field === colId);
                            })
                            .map(col => (
                              <option key={col.id} value={col.id === 'strategy' ? 'strategy' : col.id === 'account' ? 'account' : col.id}>
                                {col.label}
                              </option>
                            ))
                          }
                        </select>
                      </div>

                      {/* Run / Apply Sorting Trigger */}
                      <div className="pt-2.5 flex items-center justify-end gap-2">
                        <button
                          onClick={handleApplySort}
                          className="px-3 py-2 rounded-md bg-indigo-650 hover:bg-indigo-600 active:bg-indigo-700 text-white flex items-center gap-1.5 text-xs font-bold cursor-pointer transition-colors w-full justify-center shadow-lg shadow-indigo-950/40"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" /> Apply & Run Query
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Column Chooser Button & Popover */}
              <div className="relative">
                <button
                  id="column-chooser-toggle"
                  onClick={() => {
                    setShowColumnChooser(!showColumnChooser);
                    setShowSortManager(false);
                  }}
                  className={`p-2 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    showColumnChooser 
                      ? 'bg-slate-800 text-indigo-400 border-slate-700' 
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title="Customize Display Columns"
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline">Columns</span>
                </button>
                {/* Column Chooser Dropdown */}
                {showColumnChooser && (
                  <div 
                    id="column-chooser-panel" 
                    className="absolute right-0 mt-2 w-[520px] bg-slate-900/95 border border-slate-800 rounded-xl shadow-2xl p-4 z-40 animate-in fade-in duration-100 backdrop-blur-md"
                  >
                    {/* Header */}
                    <div className="pb-3 border-b border-slate-800 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-200 tracking-wide flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" /> Columns Configuration
                      </span>
                      <button 
                        onClick={() => setShowColumnChooser(false)} 
                        className="text-xs text-slate-500 hover:text-slate-300 font-medium"
                      >
                        Cancel
                      </button>
                    </div>

                    {/* Columns Grid */}
                    <div className="grid grid-cols-2 gap-4 py-3 min-h-[220px]">
                      
                      {/* Selected Columns Column */}
                      <div 
                        onDragOver={handleColDragOver}
                        onDrop={handleDropOnSelectedContainer}
                        className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col transition-all hover:border-slate-700/50"
                      >
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/50">
                          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                            Visible Columns ({tempColumns.filter(c => c.visible).length})
                          </span>
                        </div>
                        
                        <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[220px] pr-0.5">
                          {tempColumns.filter(c => c.visible).map((col, idx) => (
                            <div
                              key={col.id}
                              draggable
                              onDragStart={(e) => handleColDragStart(e, col.id)}
                              onDragOver={handleColDragOver}
                              onDrop={(e) => handleDropOnSelected(e, idx)}
                              className={`flex items-center justify-between bg-slate-900/90 hover:bg-slate-800/60 border border-slate-800 rounded-md p-1.5 text-xs text-slate-300 transition-all cursor-grab active:cursor-grabbing ${
                                draggedColId === col.id ? 'opacity-30 border-dashed border-indigo-500' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                <span className="w-4 h-4 bg-slate-800 text-[10px] font-bold text-slate-400 flex items-center justify-center rounded-full shrink-0">
                                  {idx + 1}
                                </span>
                                <span className="font-medium text-slate-200 truncate max-w-[120px]">
                                  {col.label}
                                </span>
                              </div>
                              
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveToAvailable(col.id);
                                }}
                                className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                title="Remove column"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          
                          {tempColumns.filter(c => c.visible).length === 0 && (
                            <div className="text-center py-6 text-[11px] text-slate-600 italic">
                              Drag columns here
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Available Columns Column */}
                      <div 
                        onDragOver={handleColDragOver}
                        onDrop={handleDropOnAvailableContainer}
                        className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col transition-all hover:border-slate-700/50"
                      >
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/50">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Hidden / Available ({tempColumns.filter(c => !c.visible).length})
                          </span>
                        </div>
                        
                        <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[220px] pr-0.5">
                          {tempColumns.filter(c => !c.visible).map((col) => (
                            <div
                              key={col.id}
                              draggable
                              onDragStart={(e) => handleColDragStart(e, col.id)}
                              className={`flex items-center justify-between bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/60 rounded-md p-1.5 text-xs text-slate-500 transition-all cursor-grab active:cursor-grabbing ${
                                draggedColId === col.id ? 'opacity-30 border-dashed border-slate-600' : ''
                              }`}
                            >
                              <span className="font-normal truncate max-w-[150px]">
                                {col.label}
                              </span>
                              
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveToSelected(col.id);
                                }}
                                className="p-1 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                title="Add column"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          
                          {tempColumns.filter(c => !c.visible).length === 0 && (
                            <div className="text-center py-6 text-[11px] text-slate-600 italic">
                              All columns visible
                            </div>
                          )}
                        </div>
                      </div>

                    </div>

                    {/* Footer Actions */}
                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 italic max-w-[200px]">
                        Drag to reorder or move between panels.
                      </span>
                      <button
                        onClick={handleApplyColumns}
                        className="px-3 py-1.5 rounded-md bg-indigo-650 hover:bg-indigo-600 active:bg-indigo-700 text-white flex items-center gap-1.5 text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-indigo-950/40"
                      >
                        <Play className="w-3 h-3 fill-current" /> Apply & Run Query
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating bulk toolbar */}
      {renderBulkActionBar()}

      {/* Main Grid Card */}
      <div className="bg-slate-950/60 rounded-xl border border-slate-800 overflow-hidden shadow-xs">
        
        {/* Mobile card view (hidden on md+) */}
        <div className="block md:hidden">
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-sans">
              <p className="text-sm font-semibold text-slate-400">No trading records found</p>
              <p className="text-xs mt-1 text-slate-600">Modify your active filter criteria or trigger new strategy signals.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {paginatedTransactions.map((tx) => {
                const isHighlighted = highlightedTxId === tx.id;
                return (
                  <div
                    key={tx.id}
                    onClick={() => onRowClick(tx)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-indigo-600/5 ${
                      isHighlighted ? 'bg-indigo-600/10 border-l-2 border-indigo-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold font-mono text-sm ${
                          tx.type === 'BUY' ? 'text-emerald-500' : 'text-rose-500'
                        }`}>{tx.type}</span>
                        <span className="font-mono font-bold text-white text-sm">{tx.symbol}</span>
                        {tx.flagged && <span className="text-amber-500 text-[10px] font-mono">⚑ FLAGGED</span>}
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase border font-mono font-bold ${
                        tx.status === 'EXECUTED' ? 'bg-slate-800 text-slate-300 border-slate-700' :
                        tx.status === 'PENDING' ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20' :
                        'bg-red-950/20 text-red-400 border-red-900/30'
                      }`}>{tx.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div>
                        <span className="text-slate-500">Qty: </span>
                        <span className="text-slate-200 font-mono">{tx.quantity}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Price: </span>
                        <span className="text-slate-200 font-mono">₹{tx.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Strategy: </span>
                        <span className="text-slate-400 truncate">{getStrategyName(tx.strategyId)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Account: </span>
                        <span className="text-slate-400 truncate">{getAccountName(tx.accountId)}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-600 font-mono mt-2">{formatDate(tx.timestamp)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Desktop table view (hidden below md) */}
        <div className="hidden md:block overflow-x-auto">
          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-sans">
              <p className="text-sm font-semibold text-slate-400">No trading records found</p>
              <p className="text-xs mt-1 text-slate-600">Modify your active filter criteria above or trigger new strategy signals.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse font-sans text-xs">
              <thead className="bg-slate-900/50 border-b border-slate-800 text-[10px] uppercase tracking-wider font-semibold text-slate-500 select-none">
                <tr>
                  {variant === 'full' && (
                    <th className="p-4 w-10 text-center">
                      <button 
                        onClick={handleSelectAll} 
                        className="p-1 rounded-sm hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Select All Rows"
                      >
                        <div className="w-4 h-4 border border-slate-700 flex items-center justify-center rounded-sm">
                          {paginatedTransactions.every(t => selectedIds.includes(t.id)) ? (
                            <span className="w-2 h-2 bg-indigo-500 rounded-xs" />
                          ) : paginatedTransactions.some(t => selectedIds.includes(t.id)) ? (
                            <span className="w-2 h-0.5 bg-slate-500" />
                          ) : null}
                        </div>
                      </button>
                    </th>
                  )}

                  {/* Dynamic Columns header projection */}
                  {visibleColumns.map(col => {
                    const colId = col.id === 'strategy' ? 'strategy' : col.id === 'account' ? 'account' : col.id;
                    
                    // Check if server-side sorting props are active
                    const serverSortIndex = sortConfigs ? sortConfigs.findIndex(c => c.field === colId) : -1;
                    const isServerSorted = serverSortIndex > -1;
                    const serverSortDir = isServerSorted ? sortConfigs![serverSortIndex].direction : null;
                    
                    const isLocalSorted = !sortConfigs && (sortField === colId || (colId === 'strategy' && sortField === 'strategy') || (colId === 'account' && sortField === 'account'));
                    const localSortDir = isLocalSorted ? sortDirection : null;

                    return (
                      <th 
                        key={col.id} 
                        onClick={(e) => handleSort(colId, e)}
                        className={`p-4 font-normal ${variant === 'full' ? 'cursor-pointer hover:bg-slate-800 hover:text-slate-100 transition-colors select-none' : ''}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{col.label}</span>
                          {variant === 'full' && (
                            <span className="flex items-center gap-0.5 text-slate-600">
                              {isServerSorted ? (
                                <>
                                  {serverSortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />}
                                  <span className="text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-300 px-1 rounded-sm">
                                    {serverSortIndex + 1}
                                  </span>
                                </>
                              ) : isLocalSorted ? (
                                localSortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-400" /> : <ArrowDown className="w-3 h-3 text-indigo-400" />
                              ) : (
                                <ArrowUpDown className="w-3.5 h-3.5 hover:text-slate-400" />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}

                  <th className="p-4 font-normal w-20 text-right pr-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 bg-slate-900/10">
                {paginatedTransactions.map((tx) => {
                  const isHighlighted = highlightedTxId === tx.id;
                  const isSelected = selectedIds.includes(tx.id);

                  return (
                    <tr
                      key={tx.id}
                      onClick={() => onRowClick(tx)}
                      className={`hover:bg-indigo-600/5 transition-colors cursor-pointer group select-none ${
                        isHighlighted ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500' : ''
                      } ${isSelected ? 'bg-indigo-600/15' : ''}`}
                    >
                      {variant === 'full' && (
                        <td className="p-4 text-center" onClick={(e) => handleSelectRow(tx.id, e)}>
                          <div className="w-4 h-4 border border-slate-700 hover:border-indigo-400 flex items-center justify-center rounded-sm transition-colors">
                            {isSelected && <span className="w-2 h-2 bg-indigo-400 rounded-xs" />}
                          </div>
                        </td>
                      )}

                      {/* Dynamic Columns values projection */}
                      {activeColumns.find(c => c.id === 'timestamp')?.visible && (
                        <td className="p-4 font-mono text-slate-400 whitespace-nowrap">
                          {formatDate(tx.timestamp)}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'type')?.visible && (
                        <td className="p-4 whitespace-nowrap">
                          <span className={`font-bold italic font-mono text-xs ${
                            tx.type === 'BUY' ? 'text-emerald-500' : 'text-rose-500'
                          }`}>
                            {tx.type}
                          </span>
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'symbol')?.visible && (
                        <td className="p-4 font-mono font-bold text-white">
                          {tx.symbol}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'strategy')?.visible && (
                        <td className="p-4 text-slate-400 truncate max-w-[140px]" title={getStrategyName(tx.strategyId)}>
                          {getStrategyName(tx.strategyId)}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'account')?.visible && (
                        <td className="p-4 text-slate-400 truncate max-w-[140px]" title={getAccountName(tx.accountId)}>
                          {getAccountName(tx.accountId)}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'quantity')?.visible && (
                        <td className="p-4 font-mono text-right text-white whitespace-nowrap">
                          {tx.quantity.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'price')?.visible && (
                        <td className="p-4 font-mono font-bold text-right text-white whitespace-nowrap">
                          {tx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'fee')?.visible && (
                        <td className="p-4 font-mono text-right text-slate-500 whitespace-nowrap">
                          ₹{tx.fee.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'status')?.visible && (
                        <td className="p-4 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase border font-mono font-bold ${
                            tx.status === 'EXECUTED' ? 'bg-slate-800 text-slate-300 border-slate-700' :
                            tx.status === 'PENDING' ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20 uppercase font-bold' :
                            'bg-red-950/20 text-red-400 border-red-900/30'
                          }`}>
                            {tx.status}
                          </span>
                        </td>
                      )}

                      {activeColumns.find(c => c.id === 'tradeId')?.visible && (
                        <td className="p-4 font-mono text-indigo-400 whitespace-nowrap select-all hover:text-indigo-300">
                          {tx.tradeId}
                        </td>
                      )}

                      <td className="p-4 text-right pr-4">
                        <div className="flex justify-end gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                          {tx.flagged && <Flag className="w-3.5 h-3.5 text-amber-500 fill-amber-500 mt-1" />}
                          <button
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                            title="Inspect Transaction Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {variant === 'full' && transactions.length > 0 && (
          <div className="px-4 py-3 bg-slate-950/80 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 select-none font-sans">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-slate-900 border border-slate-800 text-slate-200 rounded px-1.5 py-0.5 outline-hidden focus:border-indigo-500 font-mono"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="text-slate-600">|</span>
              <span>Showing <strong className="text-slate-200 font-mono">{(currentPage - 1) * pageSize + 1}</strong> to <strong className="text-slate-200 font-mono">{Math.min(currentPage * pageSize, transactions.length)}</strong> of <strong className="text-slate-200 font-mono">{transactions.length}</strong></span>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                className="p-1.5 rounded-md border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-20 disabled:hover:bg-slate-900 transition-colors"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-1 font-mono">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .map((p, index, array) => {
                    const showEllipsis = index > 0 && p - array[index - 1] > 1;
                    return (
                      <React.Fragment key={p}>
                        {showEllipsis && <span className="text-slate-600 px-1">...</span>}
                        <button
                          onClick={() => setCurrentPage(p)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                            currentPage === p 
                              ? 'bg-indigo-600 text-white font-bold' 
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                          }`}
                        >
                          {p}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                className="p-1.5 rounded-md border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-20 disabled:hover:bg-slate-900 transition-colors"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
