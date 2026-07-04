import React, { useState } from 'react';
import { Cpu, Plus, Loader2, CheckCircle2, ShieldAlert, BookOpen } from 'lucide-react';

interface StrategyTemplatesViewProps {
  strategyDefinitions: any[];
  onCreateStrategy: (name: string, description: string) => Promise<void>;
}

export default function StrategyTemplatesView({
  strategyDefinitions = [],
  onCreateStrategy,
}: StrategyTemplatesViewProps) {
  const [newStrategyName, setNewStrategyName] = useState('');
  const [newStrategyDescription, setNewStrategyDescription] = useState('');
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
      await onCreateStrategy(newStrategyName.trim(), newStrategyDescription.trim());
      setNewStrategyName('');
      setNewStrategyDescription('');
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
          
          {strategyDefinitions.length === 0 ? (
            <div className="text-center p-12 bg-slate-900/40 border border-slate-850 rounded-2xl text-slate-500 text-xs">
              No strategy templates found. Get started by defining one on the right.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {strategyDefinitions.map((strat) => {
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
                    </div>
                    
                    <div className="shrink-0">
                      {isInternal ? (
                        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-900 text-indigo-400">
                          SYSTEM INTERNAL
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-slate-850 border border-slate-800 text-slate-400">
                          USER DEFINED
                        </span>
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
    </div>
  );
}
