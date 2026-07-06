import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Broker } from '../types';
import { 
  Globe, Plus, Loader2, Landmark, CheckCircle2, ShieldAlert, 
  Trash2, Save, ExternalLink, Key, Eye, EyeOff, RefreshCw, Info, HelpCircle
} from 'lucide-react';

export default function BrokersListView() {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Selection & Form State
  const [selectedBroker, setSelectedBroker] = useState<Broker | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form Fields
  const [formData, setFormData] = useState({
    name: '',
    external_broker_id: 'upstox',
    client_id: '',
    client_secret: '',
    redirect_uri: 'http://localhost/logedin',
  });

  const fetchUserAndBrokers = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch user profile to get userId for auth redirect
      const meRes = await api.auth.getMe();
      if (meRes?.data?._id) {
        setCurrentUserId(meRes.data._id);
      }

      // Fetch brokers list
      const res = await api.brokers.list();
      setBrokers(res.items);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch brokers data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserAndBrokers();
  }, []);

  const handleSelectBroker = (broker: Broker) => {
    setSelectedBroker(broker);
    setIsCreating(false);
    setShowSecret(false);
    setFormData({
      name: broker.name,
      external_broker_id: broker.external_broker_id || 'upstox',
      client_id: broker.credentials?.client_id || '',
      client_secret: broker.credentials?.client_secret || '',
      redirect_uri: broker.credentials?.redirect_uri || 'http://localhost/logedin',
    });
  };

  const handleStartCreate = () => {
    setSelectedBroker(null);
    setIsCreating(true);
    setShowSecret(false);
    setFormData({
      name: '',
      external_broker_id: 'upstox',
      client_id: '',
      client_secret: '',
      redirect_uri: 'http://localhost/logedin',
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);

      const payload = {
        name: formData.name.trim(),
        external_broker_id: formData.external_broker_id,
        credentials: {
          client_id: formData.client_id.trim(),
          client_secret: formData.client_secret.trim(),
          redirect_uri: formData.redirect_uri.trim(),
        }
      };

      if (isCreating) {
        const createRes = await api.brokers.create(payload);
        setSuccessMsg('Broker registered successfully!');
        setIsCreating(false);
        if (createRes?.data) {
          handleSelectBroker(createRes.data);
        }
      } else if (selectedBroker) {
        const updateRes = await api.brokers.update(selectedBroker._id, payload);
        setSuccessMsg('Broker credentials updated successfully!');
        if (updateRes?.data) {
          handleSelectBroker(updateRes.data);
        }
      }

      await fetchUserAndBrokers();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save broker credentials');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBroker = async (brokerId: string) => {
    if (!window.confirm('Are you sure you want to delete this broker integration? All associated configurations will be removed.')) {
      return;
    }

    try {
      setDeletingId(brokerId);
      setError(null);
      setSuccessMsg(null);

      await api.brokers.delete(brokerId);
      setSuccessMsg('Broker configuration deleted.');
      setSelectedBroker(null);
      setIsCreating(false);

      await fetchUserAndBrokers();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete broker');
    } finally {
      setDeletingId(null);
    }
  };

  const getOAuthUrl = () => {
    return `http://localhost:8080/?userId=${encodeURIComponent(currentUserId)}`;
  };

  return (
    <div className="p-4 sm:p-8 space-y-8 text-slate-100 min-h-screen bg-slate-950 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5 gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
            <Globe className="w-7 h-7 text-indigo-400 animate-pulse" />
            Brokers Directory
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            Manage external broker API configurations. Live and real-time paper trades leverage user-defined broker integrations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={fetchUserAndBrokers}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition-colors"
            title="Refresh Directory"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleStartCreate}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-lg hover:shadow-indigo-500/10 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Integration
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-900/30 text-rose-300 rounded-xl text-xs flex items-center gap-3 animate-fade-in">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-950/30 border border-emerald-900/30 text-emerald-300 rounded-xl text-xs flex items-center gap-3 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Brokers Grid List */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-xs font-bold uppercase font-mono tracking-wider text-slate-400 flex items-center justify-between">
            <span>Registered Platforms</span>
            <span className="bg-slate-900 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-sans font-normal">
              {brokers.length} integrations
            </span>
          </h2>
          
          {loading ? (
            <div className="flex items-center justify-center p-16 bg-slate-900/20 border border-slate-900 rounded-2xl">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          ) : brokers.length === 0 ? (
            <div className="text-center p-16 bg-slate-900/20 border border-slate-900 rounded-2xl text-slate-500 text-xs">
              No integrated brokers found. Setup your first integration to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {brokers.map((broker) => {
                const isSelected = selectedBroker?._id === broker._id;
                const hasToken = !!broker.access_token;
                
                return (
                  <div 
                    key={broker._id} 
                    onClick={() => handleSelectBroker(broker)}
                    className={`p-4 bg-slate-900/40 backdrop-blur-xs border rounded-xl flex items-center justify-between hover:border-slate-700 transition-all shadow-md cursor-pointer ${
                      isSelected ? 'border-indigo-500 bg-indigo-950/10 shadow-indigo-950/5' : 'border-slate-800/80'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Landmark className={`w-4 h-4 ${broker.is_internal ? 'text-indigo-400' : 'text-slate-400'}`} />
                        <h3 className="font-bold text-sm text-slate-200">{broker.name}</h3>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          broker.is_internal 
                            ? 'bg-indigo-950/80 border border-indigo-900/50 text-indigo-400' 
                            : 'bg-slate-850 border border-slate-800 text-slate-400'
                        }`}>
                          {broker.is_internal ? 'INTERNAL' : (broker.external_broker_id?.toUpperCase() || 'CUSTOM')}
                        </span>
                        
                        {!broker.is_internal && (
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                            hasToken 
                              ? 'bg-emerald-950/60 border border-emerald-900/30 text-emerald-400' 
                              : 'bg-amber-950/60 border border-amber-900/30 text-amber-400'
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${hasToken ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {hasToken ? 'AUTHORIZED' : 'DISCONNECTED'}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {!broker.is_internal && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBroker(broker._id);
                        }}
                        disabled={deletingId === broker._id}
                        className="p-2 hover:bg-rose-950/40 text-slate-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                        title="Delete Configuration"
                      >
                        {deletingId === broker._id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Broker Configuration Workspace */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xs font-bold uppercase font-mono tracking-wider text-slate-400">
            {isCreating ? 'Configure New Integration' : 'Integration Dashboard'}
          </h2>

          {!isCreating && !selectedBroker ? (
            <div className="bg-slate-900/30 border border-slate-900 p-12 rounded-2xl text-center space-y-3">
              <Landmark className="w-12 h-12 text-slate-700 mx-auto stroke-1" />
              <div className="space-y-1">
                <p className="text-slate-400 text-xs font-bold">No Broker Selected</p>
                <p className="text-slate-500 text-[11px] max-w-xs mx-auto leading-normal">
                  Select a registered broker platform from the left panel to configure its access credentials, API secrets, and connection state.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl shadow-xl p-6 space-y-6">
              
              {/* Detail Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <Landmark className="w-6 h-6 text-indigo-400" />
                  <div>
                    <h3 className="font-extrabold text-base text-white">
                      {isCreating ? 'New Broker Configuration' : selectedBroker?.name}
                    </h3>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {isCreating ? 'Registering a new API gateway' : `Platform ID: ${selectedBroker?._id}`}
                    </p>
                  </div>
                </div>

                {!isCreating && selectedBroker?.is_internal && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-900 text-indigo-400">
                    Cobra Trades Sandbox Broker
                  </span>
                )}
              </div>

              {/* Read Only/Internal Warning */}
              {!isCreating && selectedBroker?.is_internal ? (
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-950/20 border border-indigo-900/30 rounded-xl flex items-start gap-3">
                    <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-200">Simulation Environment</h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        The Cobra Trades broker is the system's built-in simulation engine. It requires zero configuration, does not execute real-world orders, and executes trades instantly against virtual balances.
                      </p>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider">Features Available</h4>
                    <ul className="text-[11px] text-slate-400 space-y-1.5 list-disc pl-4 leading-normal">
                      <li>Unlimited sandbox accounts & virtual cash deposits</li>
                      <li>High-frequency simulation backtest execution</li>
                      <li>Zero slippage, zero broker commission options</li>
                      <li>Simulated order books & ledger reports</li>
                    </ul>
                  </div>
                </div>
              ) : (
                /* Editable Form */
                <form onSubmit={handleFormSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Broker Display Name */}
                    <div className="space-y-1.5 col-span-2 sm:col-span-1">
                      <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Broker Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g., Upstox Live, Live Broker"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    {/* External Broker ID */}
                    <div className="space-y-1.5 col-span-2 sm:col-span-1">
                      <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Broker Platform</label>
                      <select
                        value={formData.external_broker_id}
                        onChange={(e) => setFormData({ ...formData, external_broker_id: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 transition-colors"
                      >
                        <option value="upstox">Upstox API v2</option>
                        <option value="custom">Generic / Manual Connection</option>
                      </select>
                    </div>

                    {formData.external_broker_id === 'upstox' && (
                      <>
                        <div className="col-span-2 border-t border-slate-800/80 my-2 pt-4">
                          <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-indigo-400 flex items-center gap-1.5">
                            <Key className="w-4 h-4" />
                            Upstox API Gateway Credentials
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-1">
                            Paste your API credentials generated in your Upstox Developer Console.
                          </p>
                        </div>

                        {/* Client ID */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Client ID (API Key)</label>
                          <input
                            type="text"
                            required
                            placeholder="Enter Client ID"
                            value={formData.client_id}
                            onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                          />
                        </div>

                        {/* Client Secret */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Client Secret</label>
                          <div className="relative">
                            <input
                              type={showSecret ? "text" : "password"}
                              required
                              placeholder="Enter Client Secret"
                              value={formData.client_secret}
                              onChange={(e) => setFormData({ ...formData, client_secret: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => setShowSecret(!showSecret)}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                            >
                              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Redirect URI */}
                        <div className="space-y-1.5 col-span-2">
                          <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Redirect URI</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g., http://localhost/logedin"
                            value={formData.redirect_uri}
                            onChange={(e) => setFormData({ ...formData, redirect_uri: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Connection and Authentication flow */}
                  {!isCreating && selectedBroker && selectedBroker.external_broker_id === 'upstox' && (
                    <div className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-slate-200">OAuth Access Authorization</h4>
                          <p className="text-[10px] text-slate-500 mt-0.5 leading-normal">
                            Connect your Upstox trading account by completing the secure broker login dialog.
                          </p>
                        </div>
                        
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
                          selectedBroker.access_token 
                            ? 'bg-emerald-950/80 border border-emerald-900 text-emerald-400' 
                            : 'bg-amber-950/80 border border-amber-900 text-amber-400'
                        }`}>
                          {selectedBroker.access_token ? 'AUTHORIZED' : 'AWAITING ACCESS'}
                        </span>
                      </div>

                      {selectedBroker.access_token && (
                        <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1 font-mono">
                          <span className="text-[9px] uppercase font-bold text-slate-500">Access Token (Stored)</span>
                          <p className="text-[10px] text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap">
                            {selectedBroker.access_token.substring(0, 15)}...************************
                          </p>
                        </div>
                      )}

                      <a
                        href={getOAuthUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-850 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 font-bold font-mono tracking-wide rounded-lg text-[10px] border border-indigo-900/65 transition-colors cursor-pointer shadow-md"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {selectedBroker.access_token ? 'Re-authenticate Account' : 'Authenticate / Login with Upstox'}
                      </a>
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-2">
                    {isCreating ? (
                      <button
                        type="button"
                        onClick={() => setIsCreating(false)}
                        className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDeleteBroker(selectedBroker!._id)}
                        className="text-xs text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Integration
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                    >
                      {submitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {isCreating ? 'Register Connection' : 'Save Credentials'}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

            </div>
          )}

        </div>

      </div>
    </div>
  );
}
