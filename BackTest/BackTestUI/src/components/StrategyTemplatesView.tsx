import React, { useState } from 'react';
import { Cpu, Plus, Loader2, CheckCircle2, ShieldAlert, BookOpen, Edit, Trash2, AlertTriangle, X } from 'lucide-react';

interface StrategyTemplatesViewProps {
  strategyDefinitions: any[];
  onCreateStrategy: (
    name: string,
    description: string,
    advanceTradeDecision?: boolean,
    targetPts?: number,
    slPts?: number,
    targetType?: string,
    targetPct?: number,
    slPct?: number
  ) => Promise<void>;
  onEditStrategyTemplate?: (id: string, updateData: any) => Promise<void> | void;
  onDeleteStrategyTemplate?: (id: string) => Promise<void> | void;
}

export default function StrategyTemplatesView({
  strategyDefinitions = [],
  onCreateStrategy,
  onEditStrategyTemplate,
  onDeleteStrategyTemplate,
}: StrategyTemplatesViewProps) {
  const visibleDefinitions = strategyDefinitions.filter(s => s.strategy_name.toLowerCase() !== 'manual');

  // Edit / Delete state
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<any | null>(null);

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAdvanceTradeDecision, setEditAdvanceTradeDecision] = useState(false);
  const [editTargetType, setEditTargetType] = useState<'POINTS' | 'PERCENTAGE'>('POINTS');
  const [editTargetPts, setEditTargetPts] = useState<number>(500);
  const [editSlPts, setEditSlPts] = useState<number>(500);
  const [editTargetPct, setEditTargetPct] = useState<number>(2);
  const [editSlPct, setEditSlPct] = useState<number>(2);

  const handleOpenEdit = (strat: any) => {
    setEditingTemplate(strat);
    setEditName(strat.strategy_name);
    setEditDescription(strat.strategy_description || '');
    setEditAdvanceTradeDecision(strat.advance_trade_decision || false);
    setEditTargetType(strat.target_type || 'POINTS');
    setEditTargetPts(strat.target_pts || 500);
    setEditSlPts(strat.sl_pts || 500);
    setEditTargetPct(strat.target_pct || 2);
    setEditSlPct(strat.sl_pct || 2);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate || !onEditStrategyTemplate) return;
    try {
      await onEditStrategyTemplate(editingTemplate._id, {
        strategy_name: editName,
        strategy_description: editDescription,
        advance_trade_decision: editAdvanceTradeDecision,
        target_pts: editAdvanceTradeDecision ? editTargetPts : 500,
        sl_pts: editAdvanceTradeDecision ? editSlPts : 500,
        target_type: editAdvanceTradeDecision ? editTargetType : 'POINTS',
        target_pct: editAdvanceTradeDecision ? editTargetPct : 2,
        sl_pct: editAdvanceTradeDecision ? editSlPct : 2,
      });
      setEditingTemplate(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTemplate || !onDeleteStrategyTemplate) return;
    try {
      await onDeleteStrategyTemplate(deletingTemplate._id);
      setDeletingTemplate(null);
    } catch (err) {
      console.error(err);
    }
  };

  const [newStrategyName, setNewStrategyName] = useState('');
  const [newStrategyDescription, setNewStrategyDescription] = useState('');
  const [advanceTradeDecision, setAdvanceTradeDecision] = useState(false);
  const [targetType, setTargetType] = useState<'POINTS' | 'PERCENTAGE'>('POINTS');
  const [targetPts, setTargetPts] = useState<number>(500);
  const [slPts, setSlPts] = useState<number>(500);
  const [targetPct, setTargetPct] = useState<number>(2);
  const [slPct, setSlPct] = useState<number>(2);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreateStrategy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStrategyName.trim() || !newStrategyDescription.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);
      await onCreateStrategy(
        newStrategyName.trim(),
        newStrategyDescription.trim(),
        advanceTradeDecision,
        advanceTradeDecision ? targetPts : 500,
        advanceTradeDecision ? slPts : 500,
        advanceTradeDecision ? targetType : 'POINTS',
        advanceTradeDecision ? targetPct : 2,
        advanceTradeDecision ? slPct : 2
      );
      setNewStrategyName('');
      setNewStrategyDescription('');
      setAdvanceTradeDecision(false);
      setTargetType('POINTS');
      setTargetPts(500);
      setSlPts(500);
      setTargetPct(2);
      setSlPct(2);
      setSuccessMsg('Strategy Template created successfully!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to create strategy template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 space-y-8 text-slate-100 min-h-screen bg-slate-950 font-sans animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Cpu className="w-6 h-6 text-indigo-400" />
            Strategy Templates
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Create and manage algorithmic strategy templates. These definitions serve as blueprints for active deployments.
          </p>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-xl text-xs flex items-center gap-2.5">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-950/40 border border-emerald-900/30 text-emerald-300 rounded-xl text-xs flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Templates List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-bold uppercase font-mono tracking-wider text-slate-400">Available Templates</h2>
          
          {visibleDefinitions.length === 0 ? (
            <div className="text-center p-12 bg-slate-900/40 border border-slate-850 rounded-2xl text-slate-500 text-xs">
              No strategy templates found. Get started by defining one on the right.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {visibleDefinitions.map((strat) => {
                const isInternal = strat.strategy_name.toLowerCase() === 'manual';
                return (
                  <div 
                    key={strat._id} 
                    className="p-5 bg-slate-900/50 backdrop-blur-xs border border-slate-800/80 rounded-2xl flex flex-col md:flex-row md:items-start justify-between hover:border-slate-700 transition-all shadow-lg gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <BookOpen className={`w-4 h-4 ${isInternal ? 'text-indigo-400' : 'text-emerald-400'}`} />
                        <h3 className="font-bold text-sm text-slate-200">{strat.strategy_name}</h3>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                        {strat.strategy_description || 'No description provided.'}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono">
                        ID: {strat._id}
                      </p>
                      {strat.params && Object.keys(strat.params).length > 0 && (
                        <p className="text-[10px] text-slate-500 font-mono truncate max-w-xl" title={JSON.stringify(strat.params)}>
                          Params: {JSON.stringify(strat.params)}
                        </p>
                      )}
                    </div>
                    
                    <div className="shrink-0 flex items-center gap-2">
                      {isInternal ? (
                        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-900 text-indigo-400">
                          SYSTEM INTERNAL
                        </span>
                      ) : (
                        <>
                          {onEditStrategyTemplate && (
                            <button
                              onClick={() => handleOpenEdit(strat)}
                              className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 border border-slate-850 rounded-md transition-colors cursor-pointer"
                              title="Edit Strategy Template"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onDeleteStrategyTemplate && (
                            <button
                              onClick={() => setDeletingTemplate(strat)}
                              className="p-1.5 text-rose-450 hover:text-rose-400 hover:bg-slate-800 border border-slate-855 rounded-md transition-colors cursor-pointer"
                              title="Delete Strategy Template"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-slate-850 border border-slate-800 text-slate-400">
                            USER DEFINED
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create Form Card */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase font-mono tracking-wider text-slate-400">Create Template</h2>
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Define a new mathematical model schema. Once saved, it will become immediately selectable in the Deployments window to instantiate active containers.
            </p>
            
            <form onSubmit={handleCreateStrategy} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Strategy Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bollinger Bands Breakout"
                  value={newStrategyName}
                  onChange={(e) => setNewStrategyName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Description</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe trade rules, exit thresholds, indicators used, and stop-loss criteria..."
                  value={newStrategyDescription}
                  onChange={(e) => setNewStrategyDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors resize-none"
                />
              </div>
 
              {/* Checkbox for Advance Trade Decision */}
              <div className="flex items-center gap-2 py-1">
                <input
                  id="chk-advance-trade-decision"
                  type="checkbox"
                  checked={advanceTradeDecision}
                  onChange={(e) => setAdvanceTradeDecision(e.target.checked)}
                  className="w-4 h-4 rounded-sm bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="chk-advance-trade-decision" className="text-[11px] text-slate-350 select-none cursor-pointer font-bold font-sans">
                  Enable Advanced Trade Decisions (Target & Stop Loss)
                </label>
              </div>

              {advanceTradeDecision && (
                <div className="space-y-4 border border-indigo-950 bg-indigo-950/20 p-4 rounded-xl animate-in slide-in-from-top-1 duration-200">
                  <div className="space-y-1">
                    <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Target & Stop Loss System</label>
                    <select
                      value={targetType}
                      onChange={(e) => setTargetType(e.target.value as 'POINTS' | 'PERCENTAGE')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                    >
                      <option value="POINTS">Points-based</option>
                      <option value="PERCENTAGE">Percentage-based</option>
                    </select>
                  </div>

                  {targetType === 'POINTS' ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Target Points (pts)</label>
                        <input
                          type="number"
                          required
                          min={1}
                          value={targetPts}
                          onChange={(e) => setTargetPts(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Stop Loss Points (pts)</label>
                        <input
                          type="number"
                          required
                          min={1}
                          value={slPts}
                          onChange={(e) => setSlPts(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Target Percentage (%)</label>
                        <input
                          type="number"
                          required
                          step="0.01"
                          min={0.01}
                          value={targetPct}
                          onChange={(e) => setTargetPct(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Stop Loss Percentage (%)</label>
                        <input
                          type="number"
                          required
                          step="0.01"
                          min={0.01}
                          value={slPct}
                          onChange={(e) => setSlPct(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !newStrategyName.trim() || !newStrategyDescription.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create Template
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
      {/* Edit Template Modal */}
      {editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Edit className="w-4 h-4 text-indigo-400" />
                Edit Strategy Template
              </h3>
              <button 
                onClick={() => setEditingTemplate(null)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 text-slate-200">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Template Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Description</label>
                <textarea
                  required
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 h-20 resize-none"
                />
              </div>

              <div className="flex items-center gap-2 py-1">
                <input
                  id="edit-chk-advance-trade-decision"
                  type="checkbox"
                  checked={editAdvanceTradeDecision}
                  onChange={(e) => setEditAdvanceTradeDecision(e.target.checked)}
                  className="w-4 h-4 rounded-sm bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="edit-chk-advance-trade-decision" className="text-[11px] text-slate-350 select-none cursor-pointer font-bold font-sans">
                  Enable Advanced Trade Decisions (Target & Stop Loss)
                </label>
              </div>

              {editAdvanceTradeDecision && (
                <div className="space-y-4 border border-indigo-950 bg-indigo-950/20 p-4 rounded-xl animate-in slide-in-from-top-1 duration-200">
                  <div className="space-y-1">
                    <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Target & Stop Loss System</label>
                    <select
                      value={editTargetType}
                      onChange={(e) => setEditTargetType(e.target.value as 'POINTS' | 'PERCENTAGE')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                    >
                      <option value="POINTS">Points-based</option>
                      <option value="PERCENTAGE">Percentage-based</option>
                    </select>
                  </div>

                  {editTargetType === 'POINTS' ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Target Points (pts)</label>
                        <input
                          type="number"
                          required
                          value={editTargetPts}
                          onChange={(e) => setEditTargetPts(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Stop Loss Points (pts)</label>
                        <input
                          type="number"
                          required
                          value={editSlPts}
                          onChange={(e) => setEditSlPts(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Target Pct (%)</label>
                        <input
                          type="number"
                          required
                          step="0.01"
                          min={0.01}
                          value={editTargetPct}
                          onChange={(e) => setEditTargetPct(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold">Stop Loss Pct (%)</label>
                        <input
                          type="number"
                          required
                          step="0.01"
                          min={0.01}
                          value={editSlPct}
                          onChange={(e) => setEditSlPct(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingTemplate(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Update Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Template Confirmation warning */}
      {deletingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-955/90 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-rose-955 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6 bg-rose-950/20 border-b border-rose-900/30 flex items-center gap-3">
              <div className="p-2 bg-rose-900/30 rounded-lg text-rose-455">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-200 uppercase tracking-wider font-mono">
                  Delete Strategy Template
                </h3>
                <p className="text-[10px] text-rose-400 font-medium">Critical Action Required</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
                <p>
                  You are about to permanently delete strategy template <strong className="text-white font-semibold font-mono">{deletingTemplate.strategy_name}</strong> ({deletingTemplate._id}).
                </p>
                <div className="p-3.5 bg-rose-950/30 border border-rose-900/30 rounded-lg text-rose-350 space-y-2">
                  <p className="font-bold text-[10px] uppercase font-mono tracking-wider flex items-center gap-1 text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5" /> Permanent Cascading Impact
                  </p>
                  <p className="text-[11px] text-rose-350">
                    Deleting this strategy template will permanently delete:
                  </p>
                  <ul className="list-disc pl-5 text-[11px] text-rose-300 space-y-1 font-medium">
                    <li>This strategy definition record</li>
                    <li>All deployments created using this strategy definition template</li>
                    <li>All historical trades, transactions, and positions for those deployments</li>
                  </ul>
                </div>
                <p className="text-[11px] text-slate-400">
                  Please type the template name <span className="font-mono text-white select-all bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">{deletingTemplate.strategy_name}</span> below to confirm.
                </p>
              </div>

              <input
                type="text"
                placeholder="Type strategy template name to confirm"
                className="w-full bg-slate-950 border border-rose-900/30 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-rose-500 font-mono"
                onChange={(e) => {
                  const submitBtn = document.getElementById('btn-confirm-delete-template');
                  if (submitBtn) {
                    (submitBtn as HTMLButtonElement).disabled = e.target.value !== deletingTemplate.strategy_name;
                  }
                }}
              />

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setDeletingTemplate(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete-template"
                  disabled
                  onClick={handleDeleteConfirm}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
