import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Broker, ExternalBroker } from '../types';
import { 
  Globe, Plus, Loader2, Landmark, CheckCircle2, ShieldAlert, 
  Trash2, Save, ExternalLink, Key, Eye, EyeOff, RefreshCw, Info, Settings, X
} from 'lucide-react';

export default function BrokersListView() {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [externalBrokerIds, setExternalBrokerIds] = useState<ExternalBroker[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Selection & Form State
  const [selectedBroker, setSelectedBroker] = useState<Broker | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form Fields for Broker
  const [brokerName, setBrokerName] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('upstox');
  const [credentialRows, setCredentialRows] = useState<{ key: string; value: string; isSecret?: boolean }[]>([]);

  // Admin Section State for ExternalBrokerIds
  const [newExtBrokerId, setNewExtBrokerId] = useState('');
  const [submittingExt, setSubmittingExt] = useState(false);

  const fetchUserAndBrokers = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch user profile to check admin rights
      const meRes = await api.auth.getMe();
      if (meRes?.data) {
        setCurrentUserId(meRes.data._id);
        const roles = meRes.data.roles || [];
        const userIsAdmin = roles.some((role: any) => role.name === 'admin');
        setIsAdmin(userIsAdmin);
      }

      // Fetch brokers list
      const res = await api.brokers.list();
      setBrokers(res.items);

      // Fetch external broker list for dropdown
      const extRes = await api.externalBrokers.list();
      setExternalBrokerIds(extRes.items);
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
    setBrokerName(broker.name);
    setSelectedPlatform(broker.external_broker_id || 'upstox');
    
    // Convert object credentials into key-value rows
    const pairs = Object.entries(broker.credentials || {}).map(([key, value]) => ({
      key,
      value: String(value),
      isSecret: key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('key')
    }));
    setCredentialRows(pairs);
  };

  const handleStartCreate = () => {
    setSelectedBroker(null);
    setIsCreating(true);
    setBrokerName('');
    const firstPlatform = externalBrokerIds[0]?.external_broker_id || 'upstox';
    setSelectedPlatform(firstPlatform);
    
    // Auto-populate default key-value pairs if platform is upstox
    if (firstPlatform === 'upstox') {
      setCredentialRows([
        { key: 'client_id', value: '', isSecret: false },
        { key: 'client_secret', value: '', isSecret: true },
        { key: 'redirect_uri', value: 'http://localhost/logedin', isSecret: false },
      ]);
    } else {
      setCredentialRows([
        { key: 'client_id', value: '', isSecret: false },
        { key: 'client_secret', value: '', isSecret: true },
      ]);
    }
  };

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatform(platform);
    if (platform === 'upstox') {
      setCredentialRows([
        { key: 'client_id', value: '', isSecret: false },
        { key: 'client_secret', value: '', isSecret: true },
        { key: 'redirect_uri', value: 'http://localhost/logedin', isSecret: false },
      ]);
    } else {
      setCredentialRows([
        { key: 'client_id', value: '', isSecret: false },
        { key: 'client_secret', value: '', isSecret: true },
      ]);
    }
  };

  const handleAddCredentialRow = () => {
    setCredentialRows([...credentialRows, { key: '', value: '', isSecret: false }]);
  };

  const handleRemoveCredentialRow = (index: number) => {
    const updated = [...credentialRows];
    updated.splice(index, 1);
    setCredentialRows(updated);
  };

  const handleCredentialRowChange = (index: number, field: 'key' | 'value' | 'isSecret', value: any) => {
    const updated = [...credentialRows];
    if (field === 'key') {
      updated[index].key = value;
      // Auto-detect secret fields for clean masking
      const lowKey = value.toLowerCase();
      if (lowKey.includes('secret') || lowKey.includes('token') || lowKey.includes('password') || lowKey.includes('key')) {
        updated[index].isSecret = true;
      }
    } else if (field === 'value') {
      updated[index].value = value;
    } else if (field === 'isSecret') {
      updated[index].isSecret = value;
    }
    setCredentialRows(updated);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brokerName.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);

      // Convert rows back to object
      const credentialsObj: Record<string, string> = {};
      credentialRows.forEach(row => {
        if (row.key.trim()) {
          credentialsObj[row.key.trim()] = row.value.trim();
        }
      });

      const payload = {
        name: brokerName.trim(),
        external_broker_id: selectedPlatform,
        credentials: credentialsObj
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

  // Admin Section logic
  const handleAddExternalBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExtBrokerId.trim()) return;

    try {
      setSubmittingExt(true);
      setError(null);
      setSuccessMsg(null);
      await api.externalBrokers.create({ external_broker_id: newExtBrokerId.trim().toLowerCase() });
      setNewExtBrokerId('');
      setSuccessMsg('System API gateway registered successfully!');
      
      // Refresh list
      const extRes = await api.externalBrokers.list();
      setExternalBrokerIds(extRes.items);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to add external broker platform');
    } finally {
      setSubmittingExt(false);
    }
  };

  const handleDeleteExternalBroker = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this system API gateway? Normal users will no longer be able to select it when creating brokers.')) {
      return;
    }

    try {
      setError(null);
      setSuccessMsg(null);
      await api.externalBrokers.delete(id);
      setSuccessMsg('System API gateway removed.');
      
      // Refresh list
      const extRes = await api.externalBrokers.list();
      setExternalBrokerIds(extRes.items);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete system API gateway');
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
            <Globe className="w-7 h-7 text-indigo-400" />
            Brokers Directory
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            Manage external broker API configurations. Live and real-time paper trades leverage user-defined broker integrations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={fetchUserAndBrokers}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition-colors cursor-pointer"
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
        <div className="lg:col-span-1 space-y-6">
          <div className="space-y-4">
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

          {/* Admin Management Panel */}
          {isAdmin && (
            <div className="bg-slate-900/50 border border-indigo-950 p-5 rounded-2xl shadow-xl space-y-4">
              <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-indigo-400 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                API Gateways (Admin Panel)
              </h3>
              <p className="text-[10px] text-slate-400 leading-normal">
                Define the available broker connection adapters at the system level.
              </p>

              <div className="space-y-3">
                {/* Add new */}
                <form onSubmit={handleAddExternalBroker} className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. zerodha, fyers"
                    value={newExtBrokerId}
                    onChange={(e) => setNewExtBrokerId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-750 focus:outline-hidden focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={submittingExt || !newExtBrokerId.trim()}
                    className="bg-indigo-650 hover:bg-indigo-600 text-white font-bold px-3 rounded-xl text-xs flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {submittingExt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  </button>
                </form>

                {/* List of registered external broker keys */}
                <div className="space-y-1.5 max-h-48 overflow-y-auto border border-slate-850 rounded-xl p-2 bg-slate-950/30">
                  {externalBrokerIds.length === 0 ? (
                    <p className="text-[10px] text-slate-600 p-2 italic text-center">No systems registered.</p>
                  ) : (
                    externalBrokerIds.map((ext) => (
                      <div key={ext._id} className="flex items-center justify-between p-2 bg-slate-900/80 border border-slate-800/80 rounded-lg">
                        <span className="text-[11px] font-mono font-bold text-slate-300">{ext.external_broker_id}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteExternalBroker(ext._id)}
                          className="p-1 hover:bg-rose-950/40 text-slate-500 hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                          title="Remove Platform"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
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
                        placeholder="e.g., My Upstox Account"
                        value={brokerName}
                        onChange={(e) => setBrokerName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    {/* External Broker ID (Choice from db list) */}
                    <div className="space-y-1.5 col-span-2 sm:col-span-1">
                      <label className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">Broker Platform</label>
                      <select
                        value={selectedPlatform}
                        onChange={(e) => handlePlatformChange(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 transition-colors"
                      >
                        {externalBrokerIds.map((ext) => (
                          <option key={ext._id} value={ext.external_broker_id}>
                            {ext.external_broker_id.toUpperCase()} API
                          </option>
                        ))}
                        {externalBrokerIds.length === 0 && (
                          <option value="upstox">UPSTOX API</option>
                        )}
                        <option value="custom">CUSTOM / GENERIC</option>
                      </select>
                    </div>

                    {/* Dynamic Credentials Section */}
                    <div className="col-span-2 border-t border-slate-800/80 my-2 pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-indigo-400 flex items-center gap-1.5">
                            <Key className="w-4 h-4" />
                            API Gateway Credentials
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-1">
                            Configure key-value settings required by the broker gateway.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleAddCredentialRow}
                          className="bg-slate-900 hover:bg-slate-800 text-[10px] font-bold font-mono px-2.5 py-1.5 rounded-lg border border-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-indigo-400" />
                          Add Setting
                        </button>
                      </div>

                      {/* Key-Value Fields list */}
                      <div className="space-y-3">
                        {credentialRows.length === 0 ? (
                          <div className="p-6 text-center border border-dashed border-slate-800 rounded-xl text-[11px] text-slate-555">
                            No credentials parameters configured. Add parameters above.
                          </div>
                        ) : (
                          credentialRows.map((row, index) => (
                            <CredentialRow
                              key={index}
                              index={index}
                              row={row}
                              onChange={handleCredentialRowChange}
                              onRemove={handleRemoveCredentialRow}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Connection and Authentication flow */}
                  {!isCreating && selectedBroker && selectedPlatform === 'upstox' && (
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

// Sub-component for clean Credential Row management
interface CredentialRowProps {
  key?: any;
  index: number;
  row: { key: string; value: string; isSecret?: boolean };
  onChange: (index: number, field: 'key' | 'value' | 'isSecret', value: any) => void;
  onRemove: (index: number) => void;
}

function CredentialRow({ index, row, onChange, onRemove }: CredentialRowProps) {
  const [showVal, setShowVal] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-950/60 p-3 border border-slate-850 rounded-xl animate-fade-in">
      {/* Parameter Key */}
      <div className="flex-1">
        <input
          type="text"
          required
          placeholder="Setting Key (e.g. client_id)"
          value={row.key}
          onChange={(e) => onChange(index, 'key', e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-700 focus:outline-hidden focus:border-indigo-500 transition-colors font-mono"
        />
      </div>

      {/* Parameter Value */}
      <div className="flex-1.5 flex items-center gap-1.5 relative">
        <input
          type={row.isSecret && !showVal ? "password" : "text"}
          required
          placeholder="Value"
          value={row.value}
          onChange={(e) => onChange(index, 'value', e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-3 pr-8 py-2 text-xs text-slate-200 placeholder-slate-700 focus:outline-hidden focus:border-indigo-500 transition-colors font-mono"
        />
        {row.isSecret && (
          <button
            type="button"
            onClick={() => setShowVal(!showVal)}
            className="absolute right-2 text-slate-500 hover:text-slate-300"
          >
            {showVal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Mode/Delete actions */}
      <div className="flex items-center gap-1 justify-end mt-2 sm:mt-0">
        <button
          type="button"
          onClick={() => onChange(index, 'isSecret', !row.isSecret)}
          className={`p-1.5 rounded-lg border text-[10px] font-mono transition-all cursor-pointer ${
            row.isSecret
              ? 'bg-indigo-950/60 border-indigo-900 text-indigo-400'
              : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-350'
          }`}
          title="Toggle Password Masking"
        >
          {row.isSecret ? 'MASKED' : 'PLAIN'}
        </button>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="p-2 hover:bg-rose-950/40 text-slate-500 hover:text-rose-450 rounded-lg transition-colors cursor-pointer"
          title="Remove Row"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
