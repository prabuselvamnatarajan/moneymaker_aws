import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Broker } from '../types';
import { Globe, Plus, Loader2, Landmark, CheckCircle2, ShieldAlert } from 'lucide-react';

export default function BrokersListView() {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBrokerName, setNewBrokerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchBrokers = async () => {
    try {
      setLoading(true);
      const res = await api.brokers.list();
      setBrokers(res.items);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch brokers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBrokers();
  }, []);

  const handleCreateBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrokerName.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);
      await api.brokers.create(newBrokerName.trim());
      setNewBrokerName('');
      setSuccessMsg('Broker registered successfully!');
      fetchBrokers();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to register broker');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 space-y-8 text-slate-100 min-h-screen bg-slate-950 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-indigo-400" />
            Brokers Directory
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage integrated brokerage platforms. Paper & simulation accounts are locked to the internal Cobra Trades broker.
          </p>
        </div>
      </div>

      {/* Status Notifications */}
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
        {/* Brokers List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-bold uppercase font-mono tracking-wider text-slate-400">Registered Brokers</h2>
          
          {loading ? (
            <div className="flex items-center justify-center p-12 bg-slate-900/40 border border-slate-850 rounded-2xl">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : brokers.length === 0 ? (
            <div className="text-center p-12 bg-slate-900/40 border border-slate-850 rounded-2xl text-slate-500 text-xs">
              No brokers found. Get started by registering one on the right.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {brokers.map((broker) => (
                <div 
                  key={broker._id} 
                  className="p-5 bg-slate-900/50 backdrop-blur-xs border border-slate-800/80 rounded-2xl flex items-start justify-between hover:border-slate-700 transition-all shadow-lg"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Landmark className={`w-4 h-4 ${broker.is_internal ? 'text-indigo-400' : 'text-slate-400'}`} />
                      <h3 className="font-bold text-sm text-slate-200">{broker.name}</h3>
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono">
                      Registered: {new Date(broker.created_at || Date.now()).toLocaleDateString()}
                    </p>
                  </div>
                  
                  {broker.is_internal ? (
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-900 text-indigo-400">
                      INTERNAL
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-slate-850 border border-slate-800 text-slate-400">
                      EXTERNAL
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Register Form Card */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase font-mono tracking-wider text-slate-400">Register Broker</h2>
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Define a new external brokerage partner to link with Live trade accounts. Custom-defined brokers are accessible when setting up live deployment nodes.
            </p>
            
            <form onSubmit={handleCreateBroker} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Broker Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Zerodha, Interactive Brokers"
                  value={newBrokerName}
                  onChange={(e) => setNewBrokerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !newBrokerName.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Register Broker
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
