import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, Landmark, ShieldCheck, ShieldAlert, DollarSign, 
  Activity, ArrowRight, ChevronRight, X, Sparkles, Loader2, CheckCircle2, RefreshCw,
  Edit, Trash2, AlertTriangle
} from 'lucide-react';
import { Account, Broker } from '../types';
import { api } from '../api';

interface AccountsListViewProps {
  accounts: Account[];
  brokers: Broker[];
  onAddAccount: (newAcc: Account) => void;
  onToggleBrokerStatus: (id: string) => void;
  onNavigateToEntity: (type: 'account', id: string) => void;
  onRefreshData?: () => Promise<void> | void;
  onEditAccount?: (id: string, updateData: any) => Promise<void> | void;
  onDeleteAccount?: (id: string) => Promise<void> | void;
}

export default function AccountsListView({
  accounts,
  brokers: initialBrokers,
  onAddAccount,
  onToggleBrokerStatus,
  onNavigateToEntity,
  onRefreshData,
  onEditAccount,
  onDeleteAccount
}: AccountsListViewProps) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Edit / Delete State
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');

  useEffect(() => {
    if (!deletingAccount) {
      setDeleteConfirmInput('');
    }
  }, [deletingAccount]);

  const [editName, setEditName] = useState('');
  const [editCommissionType, setEditCommissionType] = useState<'PERCENTAGE' | 'FLAT'>('PERCENTAGE');
  const [editCommissionRate, setEditCommissionRate] = useState('');
  const [editStatus, setEditStatus] = useState<'connected' | 'disconnected'>('connected');
  const [editDescription, setEditDescription] = useState('');
  const [editBrokerId, setEditBrokerId] = useState('');

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    setEditName(acc.name);
    setEditCommissionType(acc.commissionType || 'PERCENTAGE');
    setEditCommissionRate(acc.commissionRate?.toString() || '');
    setEditStatus(acc.status);
    setEditDescription(acc.description || '');
    setEditBrokerId(acc.brokerId || '');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount || !onEditAccount) return;
    try {
      await onEditAccount(editingAccount.id, {
        account_name: editName,
        commission_type: editCommissionType,
        commission_rate: editCommissionRate ? parseFloat(editCommissionRate) : 0,
        is_active: editStatus === 'connected',
        description: editDescription,
        broker_id: editBrokerId || undefined,
      });
      setEditingAccount(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingAccount || !onDeleteAccount) return;
    try {
      await onDeleteAccount(deletingAccount.id);
      setDeletingAccount(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefresh = async () => {
    if (onRefreshData) {
      setRefreshing(true);
      try {
        await onRefreshData();
      } finally {
        setRefreshing(false);
      }
    }
  };
  
  // Form fields
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [balance, setBalance] = useState('');
  const [margin, setMargin] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [status, setStatus] = useState<'connected' | 'disconnected'>('connected');
  const [commissionType, setCommissionType] = useState<'PERCENTAGE' | 'FLAT'>('PERCENTAGE');
  const [commissionRate, setCommissionRate] = useState('');

  // Enhanced fields for Type and Broker selection
  const [accountType, setAccountType] = useState<'LIVE' | 'PAPER' | 'SIMULATION'>('SIMULATION');
  const [brokerId, setBrokerId] = useState('');
  const [brokers, setBrokers] = useState<Broker[]>(initialBrokers);

  // Inline broker registration
  const [showInlineBrokerForm, setShowInlineBrokerForm] = useState(false);
  const [inlineBrokerName, setInlineBrokerName] = useState('');
  const [inlineBrokerSubmitting, setInlineBrokerSubmitting] = useState(false);
  const [inlineBrokerError, setInlineBrokerError] = useState<string | null>(null);

  useEffect(() => {
    setBrokers(initialBrokers);
  }, [initialBrokers]);

  useEffect(() => {
    if (!showAddForm || brokers.length > 0) return;
    let cancelled = false;
    api.brokers
      .list()
      .then((res) => {
        if (!cancelled && Array.isArray(res.items)) {
          setBrokers(res.items);
        }
      })
      .catch((err) => console.error('[AccountsListView] Failed to load brokers for add form', err));
    return () => {
      cancelled = true;
    };
  }, [showAddForm, brokers.length]);

  // Auto-select broker based on account type selection
  useEffect(() => {
    if (accountType === 'SIMULATION' || accountType === 'PAPER') {
      const internalB = brokers.find(b => b.is_internal || b.name === 'Cobra Trades');
      if (internalB) {
        setBrokerId(internalB._id);
        setBroker(internalB.name);
      }
    } else {
      // For LIVE account, select first external broker if any, else default to internal
      const externalB = brokers.find(b => !b.is_internal && b.name !== 'Cobra Trades');
      if (externalB) {
        setBrokerId(externalB._id);
        setBroker(externalB.name);
      } else {
        const internalB = brokers.find(b => b.is_internal || b.name === 'Cobra Trades');
        if (internalB) {
          setBrokerId(internalB._id);
          setBroker(internalB.name);
        }
      }
    }
  }, [accountType, brokers]);

  // Computed metrics
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalPnl = accounts.reduce((sum, a) => sum + a.pnl, 0);
  const connectedCount = accounts.filter(a => a.status === 'connected').length;

  const filteredAccounts = accounts.filter(a => 
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.broker.toLowerCase().includes(search.toLowerCase()) ||
    a.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateBrokerInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineBrokerName.trim()) return;

    try {
      setInlineBrokerSubmitting(true);
      setInlineBrokerError(null);
      const res = await api.brokers.create({ name: inlineBrokerName.trim() });
      const newB = res.data;
      setBrokers(prev => [...prev, newB]);
      setBrokerId(newB._id);
      setBroker(newB.name);
      setInlineBrokerName('');
      setShowInlineBrokerForm(false);
    } catch (err: any) {
      setInlineBrokerError(err.message || 'Failed to register broker');
    } finally {
      setInlineBrokerSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !brokerId || !balance) return;

    const initialVal = parseFloat(balance);
    const marginVal = margin ? parseFloat(margin) : initialVal * 0.7;

    const selectedB = brokers.find(b => b._id === brokerId);

    const newAcc: Account = {
      id: `ACC-00${accounts.length + 1}`,
      name,
      broker: selectedB ? selectedB.name : 'Cobra Trades',
      balance: initialVal,
      margin: marginVal,
      initialBalance: initialVal,
      pnl: 0,
      currency,
      status,
      commissionType,
      commissionRate: commissionRate ? parseFloat(commissionRate) : 0,
      accountType,
      brokerId,
    };

    onAddAccount(newAcc);
    
    // Reset form
    setName('');
    setBalance('');
    setMargin('');
    setStatus('connected');
    setCommissionType('PERCENTAGE');
    setCommissionRate('');
    setAccountType('SIMULATION');
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Landmark className="w-5 h-5 text-indigo-400" />
            Brokerage Accounts Directory
          </h2>
          <p className="text-xs text-slate-500">
            Audit and configure registered brokerage connections, leverage boundaries, and capital distribution.
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2 shrink-0 self-start sm:self-center">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
            title="Refresh accounts list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            id="btn-register-account-trigger"
            onClick={() => setShowAddForm(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 shrink-0"
          >
            <Plus className="w-4 h-4" /> Register New Account
          </button>
        </div>
      </div>

      {/* Aggregate Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 font-sans">
        
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Total Net Liquidation</p>
          <p className="text-xl font-black font-mono text-slate-100 mt-1.5">
            ₹{totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Overall Capital P&L</p>
          <p className={`text-xl font-black font-mono mt-1.5 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Connection Stability</p>
          <p className="text-xl font-bold font-mono text-slate-100 mt-1.5">
            {connectedCount} / {accounts.length} <span className="text-xs text-slate-500 font-normal">Active</span>
          </p>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Average Capital Density</p>
          <p className="text-xl font-bold font-mono text-indigo-400 mt-1.5">
            ₹{(totalBalance / (accounts.length || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>

      </div>

      {/* Filters Bar */}
      <div className="flex items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts by name, API provider, ID..."
            className="w-full bg-slate-900 border border-slate-800 rounded-md pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 font-sans"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Accounts Ledger Grid / List */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden font-sans">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
          <span className="text-xs font-bold text-slate-300">Registered Brokerage Records ({filteredAccounts.length})</span>
          <span className="text-[10px] text-slate-500 font-mono">Toggling connection triggers system audits</span>
        </div>

        {filteredAccounts.length > 0 ? (
          <div className="divide-y divide-slate-800/60">
            {filteredAccounts.map(acc => {
              const isPnlPositive = acc.pnl >= 0;
              const isConnected = acc.status === 'connected';
              return (
                <div 
                  key={acc.id}
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-indigo-600/5 transition-colors group select-none"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-slate-900 rounded-lg text-indigo-400 border border-slate-850 shrink-0 mt-0.5">
                      <Landmark className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 hover:text-indigo-400 transition-colors cursor-pointer" onClick={() => onNavigateToEntity('account', acc.id)}>
                          {acc.name}
                        </span>
                        <span className="text-[10px] font-mono bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded border border-slate-800">
                          {acc.id}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        API Provider: <span className="text-slate-400">{acc.broker}</span>
                        {acc.commissionRate !== undefined && (
                          <span className="text-slate-500">
                            {' • Commission: '}
                            <span className="text-slate-400">
                              {acc.commissionType === 'FLAT' ? `₹${acc.commissionRate}` : `${acc.commissionRate}%`}
                            </span>
                          </span>
                        )}
                      </p>
                      
                      {/* Connection status toggle pill */}
                      <button 
                        onClick={() => onToggleBrokerStatus(acc.id)}
                        className={`inline-flex items-center gap-1.5 mt-2.5 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                          isConnected 
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30' 
                            : 'bg-rose-950/40 text-rose-400 border-rose-900/30'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                        {isConnected ? 'API SESSION ACTIVE' : 'API DISCONNECTED'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 md:gap-8 lg:gap-12">
                    
                    {/* Balance */}
                    <div className="space-y-0.5 min-w-[100px]">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Total Balance</p>
                      <p className="text-sm font-bold font-mono text-slate-200">
                        ₹{acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>

                    {/* Margin */}
                    <div className="space-y-0.5 min-w-[100px]">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Available Margin</p>
                      <p className="text-xs font-semibold font-mono text-slate-400">
                        ₹{acc.margin.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                      </p>
                    </div>

                    {/* Cumulative Yield */}
                    <div className="space-y-0.5 min-w-[100px]">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Account P&L</p>
                      <p className={`text-sm font-bold font-mono ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPnlPositive ? '+' : ''}₹{acc.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>

                    {/* Drilling navigation */}
                    <button
                      onClick={() => onNavigateToEntity('account', acc.id)}
                      className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg transition-all flex items-center gap-1 text-xs cursor-pointer group-hover:translate-x-0.5 duration-200"
                    >
                      Audit Ledger <ChevronRight className="w-4 h-4" />
                    </button>

                    {onEditAccount && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEdit(acc);
                        }}
                        className="p-2 text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg transition-all flex items-center gap-1 text-xs cursor-pointer"
                        title="Edit Account"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    )}

                    {onDeleteAccount && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingAccount(acc);
                        }}
                        className="p-2 text-rose-450 hover:text-rose-455 hover:bg-slate-900 border border-transparent hover:border-slate-800 rounded-lg transition-all flex items-center gap-1 text-xs cursor-pointer"
                        title="Delete Account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500">
            No registered brokerage accounts matched your search queries.
          </div>
        )}
      </div>

      {/* Add Account Modal Overlay */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Landmark className="w-4 h-4 text-indigo-400" />
                Register New Brokerage
              </h3>
              <button 
                onClick={() => setShowAddForm(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Account Friendly Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Apex Arbitrage Pro"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Account Deployment Mode</label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="SIMULATION">SIMULATION (Paper / Mock Execution)</option>
                  <option value="PAPER">PAPER (Real-time Live Feed Mock Execution)</option>
                  <option value="LIVE">LIVE (Real Funds Production Node)</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Associated Broker</label>
                  {accountType === 'LIVE' && (
                    <button
                      type="button"
                      onClick={() => setShowInlineBrokerForm(!showInlineBrokerForm)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold"
                    >
                      {showInlineBrokerForm ? 'Cancel New' : '+ Register New Broker'}
                    </button>
                  )}
                </div>

                {showInlineBrokerForm && accountType === 'LIVE' ? (
                  <div className="p-3 bg-slate-950/60 border border-indigo-950 rounded-lg space-y-2.5 mt-1">
                    <p className="text-[10px] text-slate-400">Register new external broker instance directly to DB:</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Broker name, e.g., Zerodha"
                        value={inlineBrokerName}
                        onChange={(e) => setInlineBrokerName(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleCreateBrokerInline}
                        disabled={inlineBrokerSubmitting || !inlineBrokerName.trim()}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-md text-xs disabled:opacity-50 flex items-center gap-1 shrink-0"
                      >
                        {inlineBrokerSubmitting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          'Add'
                        )}
                      </button>
                    </div>
                    {inlineBrokerError && (
                      <p className="text-[10px] text-rose-400 font-mono">{inlineBrokerError}</p>
                    )}
                  </div>
                ) : (
                  <select
                    value={brokerId}
                    onChange={(e) => setBrokerId(e.target.value)}
                    disabled={accountType !== 'LIVE'}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500 disabled:opacity-75 disabled:text-slate-500"
                  >
                    {brokers.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name} {b.is_internal ? '(Internal Only)' : '(External)'}
                      </option>
                    ))}
                  </select>
                )}
                {(accountType === 'SIMULATION' || accountType === 'PAPER') && (
                  <p className="text-[10px] text-slate-500 mt-1 italic leading-relaxed">
                    * Paper and Simulation accounts are locked to the internal Cobra Trades brokerage definition. Only LIVE accounts can connect to custom external brokers.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Initial Deposit (INR)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Available Margin (INR)</label>
                  <input
                    type="number"
                    min="0"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    placeholder="Default: 70% of deposit"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Commission Type</label>
                  <select
                    value={commissionType}
                    onChange={(e) => setCommissionType(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FLAT">Flat Fee (INR)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">
                    Commission Rate ({commissionType === 'PERCENTAGE' ? '%' : '₹'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value)}
                    placeholder={commissionType === 'PERCENTAGE' ? "e.g. 0.05" : "e.g. 20"}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Base Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="INR">INR (₹)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Initial Hook Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="connected">Connected (Active Session)</option>
                    <option value="disconnected">Disconnected (Standby Mode)</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Save Broker Record
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Edit className="w-4 h-4 text-indigo-400" />
                Edit Brokerage Account
              </h3>
              <button 
                onClick={() => setEditingAccount(null)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Account Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Description / Notes</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Additional context or references"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 h-20 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Commission Type</label>
                  <select
                    value={editCommissionType}
                    onChange={(e) => setEditCommissionType(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-205 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FLAT">Flat Rate (₹)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">
                    Commission Rate ({editCommissionType === 'PERCENTAGE' ? '%' : '₹'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={editCommissionRate}
                    onChange={(e) => setEditCommissionRate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 font-mono focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Account Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-205 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="connected">Connected (Active)</option>
                  <option value="disconnected">Disconnected (Standby)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Update Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Warning Modal */}
      {deletingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-rose-950 rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6 bg-rose-950/20 border-b border-rose-900/30 flex items-center gap-3">
              <div className="p-2 bg-rose-900/30 rounded-lg text-rose-455">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-200 uppercase tracking-wider font-mono">
                  Confirm Cascading Deletion
                </h3>
                <p className="text-[10px] text-rose-400 font-medium">Critical Security Warning</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
                <p>
                  You are about to permanently delete account <strong className="text-white font-semibold font-mono">{deletingAccount.name}</strong> ({deletingAccount.id}).
                </p>
                <div className="p-3.5 bg-rose-950/30 border border-rose-900/30 rounded-lg text-rose-300 space-y-2">
                  <p className="font-bold text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Permanent Cascading Impact
                  </p>
                  <p className="text-[11px]">
                    This action is destructive and irreversible. The system will permanently delete:
                  </p>
                  <ul className="list-disc pl-5 text-[11px] space-y-1 mt-1 font-medium">
                    <li>This account record</li>
                    <li>All deployments created using this account</li>
                    <li>All historical trades, execution reports, and ledger details for these deployments</li>
                    <li>All related active positions and Redis caching states</li>
                  </ul>
                </div>
                <p className="text-[11px] text-slate-400">
                  Please type the account name <span className="font-mono text-white select-all bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">{deletingAccount.name}</span> below to confirm.
                </p>
              </div>

              <input
                type="text"
                placeholder="Type account name to confirm"
                value={deleteConfirmInput}
                className="w-full bg-slate-950 border border-rose-900/30 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-rose-500 font-mono"
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
              />

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setDeletingAccount(null)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete-acc"
                  disabled={deleteConfirmInput !== deletingAccount.name}
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
