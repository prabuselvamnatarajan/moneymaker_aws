/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  User, Mail, Shield, ShieldAlert, Key, Smartphone, HardDrive, 
  Trash2, Plus, CheckCircle, RefreshCw, Eye, EyeOff, Check, X,
  Globe, ShieldCheck, Laptop, Clock, AlertCircle, Copy
} from 'lucide-react';

interface ActiveSession {
  id: string;
  device: string;
  os: string;
  browser: string;
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

interface ApiKey {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsed: string;
}

import { api } from '../api';

interface UserProfileViewProps {
  currentUser: { name: string; username: string; email: string; _id: string; is_mfa_enabled: boolean; backup_codes?: string[] } | null;
  onLogout: () => void;
  onProfileUpdate: () => void;
}

export default function UserProfileView({ currentUser, onLogout, onProfileUpdate }: UserProfileViewProps) {
  // User profile state
  const [name, setName] = useState(currentUser?.name || 'Prabu Selvam');
  const [username, setUsername] = useState(currentUser?.username || 'prabuselvam');
  const [email, setEmail] = useState(currentUser?.email || 'prabuselvamonline@gmail.com');
  const [role, setRole] = useState('Senior Algo Operator');
  const [mfaEnabled, setMfaEnabled] = useState(currentUser?.is_mfa_enabled || false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // MFA setup modal states
  const [showMfaSetupModal, setShowMfaSetupModal] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState<{ otpauthUrl: string; qrCodeDataUrl: string; tempSecret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  React.useEffect(() => {
    if (currentUser) {
      setName(currentUser.name);
      setUsername(currentUser.username);
      setEmail(currentUser.email);
      setMfaEnabled(currentUser.is_mfa_enabled || false);
    }
  }, [currentUser]);

  const handleMfaToggle = async () => {
    if (mfaEnabled) {
      if (!window.confirm("Are you sure you want to disable Multi-Factor Authentication? This makes your account less secure.")) {
        return;
      }
      setMfaLoading(true);
      try {
        await api.mfa.disable();
        onProfileUpdate();
        showToast('success', 'Multi-factor authentication has been disabled successfully');
      } catch (err: any) {
        showToast('error', err.message || 'Failed to disable MFA');
      } finally {
        setMfaLoading(false);
      }
    } else {
      setMfaCode('');
      setMfaError(null);
      setMfaSetupData(null);
      setShowMfaSetupModal(true);
      setMfaLoading(true);
      try {
        const data = await api.mfa.setup();
        setMfaSetupData(data);
      } catch (err: any) {
        setMfaError(err.message || 'Failed to initialize MFA setup');
        showToast('error', err.message || 'Failed to initialize MFA setup');
      } finally {
        setMfaLoading(false);
      }
    }
  };

  const handleVerifySetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.length < 6) {
      setMfaError('Please enter a 6-digit confirmation code');
      return;
    }
    setMfaLoading(true);
    setMfaError(null);
    try {
      await api.mfa.verifySetup(mfaCode);
      onProfileUpdate();
      setShowMfaSetupModal(false);
      showToast('success', 'Multi-factor authentication enabled successfully');
    } catch (err: any) {
      setMfaError(err.message || 'Verification failed. Please try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  // Edit states
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [tempName, setTempName] = useState(name);
  const [tempUsername, setTempUsername] = useState(username);
  const [tempEmail, setTempEmail] = useState(email);

  // Password update state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Active sessions state
  const [sessions, setSessions] = useState<ActiveSession[]>([
    {
      id: 'sess-1',
      device: 'MacBook Pro 16"',
      os: 'macOS Sequoia',
      browser: 'Chrome 126.0',
      ip: '192.168.1.15',
      location: 'Singapore (SG)',
      lastActive: 'Just now',
      current: true
    },
    {
      id: 'sess-2',
      device: 'iPhone 15 Pro',
      os: 'iOS 18.0',
      browser: 'Safari Mobile',
      ip: '112.199.43.102',
      location: 'Singapore (SG)',
      lastActive: '4 hours ago',
      current: false
    },
    {
      id: 'sess-3',
      device: 'Ubuntu Server Workstation',
      os: 'Ubuntu 24.04 LTS',
      browser: 'CLI Agent Daemon v4.1',
      ip: '52.76.21.198',
      location: 'AWS Singapore (ap-southeast-1)',
      lastActive: 'Yesterday',
      current: false
    }
  ]);

  // API keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([
    {
      id: 'key-1',
      name: 'Binance Bot Endpoint Integration',
      tokenPrefix: 'ct_live_7a9f...',
      createdAt: '2026-05-15',
      lastUsed: '10 mins ago'
    },
    {
      id: 'key-2',
      name: 'Local Backtester Python Daemon',
      tokenPrefix: 'ct_test_b8d2...',
      createdAt: '2026-06-01',
      lastUsed: '2 hours ago'
    }
  ]);

  const [newKeyName, setNewKeyName] = useState('');
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // Handlers
  const handleSaveInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempName || !tempUsername || !tempEmail) {
      showToast('error', 'All profile fields are required');
      return;
    }
    setName(tempName);
    setUsername(tempUsername);
    setEmail(tempEmail);
    setIsEditingInfo(false);
    showToast('success', 'Profile identity updated successfully');
  };

  const handleCancelEdit = () => {
    setTempName(name);
    setTempUsername(username);
    setTempEmail(email);
    setIsEditingInfo(false);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('error', 'Please fill out all password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('error', 'New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      showToast('error', 'Password must be at least 8 characters long');
      return;
    }

    try {
      await api.auth.changePassword(currentPassword, newPassword);
      showToast('success', 'Account security credentials updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordModal(false);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to change password');
    }
  };

  const handleRevokeSession = (sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    showToast('success', 'Session access revoked successfully');
  };

  const handleCreateApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName) return;

    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const fullKey = `ct_live_${randomHex}`;
    
    const newKey: ApiKey = {
      id: `key-${apiKeys.length + 1}`,
      name: newKeyName,
      tokenPrefix: `${fullKey.substring(0, 12)}...`,
      createdAt: new Date().toISOString().split('T')[0],
      lastUsed: 'Never'
    };

    setApiKeys(prev => [newKey, ...prev]);
    setGeneratedKey(fullKey);
    setNewKeyName('');
  };

  const handleRevokeApiKey = (keyId: string) => {
    setApiKeys(prev => prev.filter(k => k.id !== keyId));
    showToast('success', 'API access token revoked');
  };

  const showToast = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(null);
    }, 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Toast Alert */}
      {statusMessage && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4.5 py-3 rounded-lg border shadow-xl animate-in slide-in-from-bottom duration-200 font-sans text-xs ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-950/90 text-emerald-400 border-emerald-800' 
            : 'bg-rose-950/90 text-rose-400 border-rose-800'
        }`}>
          {statusMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="font-semibold">{statusMessage.text}</span>
        </div>
      )}

      {/* Profile Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-400" />
            Operator Profile & Security Center
          </h2>
          <p className="text-xs text-slate-500">
            Manage your personal identity details, active trading terminal sessions, API tokens, and credentials.
          </p>
        </div>
        
        <div className="flex items-center gap-2 text-xs font-mono font-bold bg-slate-900 px-3.5 py-1.5 rounded-lg border border-slate-800">
          <Shield className="w-4 h-4 text-indigo-400" />
          <span>OPERATOR STATUS: ENCRYPTED</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
        
        {/* Left Side: Avatar and Account Identity */}
        <div className="space-y-6 lg:col-span-1">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 text-center space-y-4">
            <div className="relative inline-block">
              <div className="w-24 h-24 rounded-full bg-slate-900 border-2 border-indigo-500/30 flex items-center justify-center text-3xl font-black text-white shadow-xl mx-auto">
                {name.split(' ').map(n => n[0]).join('')}
              </div>
              <span className="absolute bottom-1 right-1 w-4.5 h-4.5 bg-emerald-500 rounded-full border-2 border-slate-950 animate-pulse" title="Operator online" />
            </div>

            <div>
              <h3 className="text-base font-extrabold text-slate-100">{name}</h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">@{username}</p>
              <div className="inline-flex items-center gap-1 bg-indigo-500/5 text-indigo-400 border border-indigo-500/10 px-2.5 py-0.5 rounded-full text-[10px] uppercase font-mono mt-2.5 font-bold">
                {role}
              </div>
            </div>

            <div className="border-t border-slate-900 pt-4 text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Department:</span>
                <span className="text-slate-300 font-medium">Algorithmic Trading Ops</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Enrolled Since:</span>
                <span className="text-slate-300 font-medium font-mono">2024-10-12</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Assigned Cluster:</span>
                <span className="text-slate-300 font-medium font-mono text-[11px]">COBRANET-US-EAST-01</span>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="w-full bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/30 text-rose-300 py-2 rounded-lg text-xs font-bold font-mono tracking-wider uppercase mt-4 transition-colors cursor-pointer"
            >
              Sign Out Session
            </button>
          </div>

          {/* Quick Security Status Toggles */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Platform Safeguards</h4>
            
            {/* MFA toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-850">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                  MFA Authentication
                </p>
                <p className="text-[10px] text-slate-500">Requires authenticator code</p>
              </div>
              <button 
                onClick={handleMfaToggle}
                disabled={mfaLoading}
                className={`w-10 h-5.5 rounded-full transition-all flex items-center p-0.5 cursor-pointer ${mfaEnabled ? 'bg-indigo-600 justify-end' : 'bg-slate-800 justify-start'} disabled:opacity-50`}
              >
                <span className="w-4.5 h-4.5 rounded-full bg-white shadow-md" />
              </button>
            </div>

            {/* Display Backup Codes if MFA is Enabled */}
            {currentUser?.backup_codes && currentUser.backup_codes.length > 0 && mfaEnabled && (
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-850 space-y-2 mt-3">
                <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">MFA Backup Recovery Codes</p>
                <p className="text-[9px] text-slate-500">Save these codes in a safe place. They can be used to access your account if you lose your authenticator device.</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-indigo-300">
                  {currentUser.backup_codes.map((code, idx) => (
                    <div key={idx} className="bg-slate-950 px-2 py-1 rounded border border-slate-800 text-center select-all font-semibold">
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Session Lockdown */}
            <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-850">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
                  Emergency Revocation
                </p>
                <p className="text-[10px] text-slate-500">Revoke all sessions but current</p>
              </div>
              <button 
                onClick={() => {
                  setSessions(prev => prev.filter(s => s.current));
                  showToast('success', 'Emergency sweep: all other sessions disconnected.');
                }}
                className="px-2 py-1 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-900/40 text-rose-400 rounded text-[10px] font-mono uppercase tracking-wider font-semibold cursor-pointer transition-colors"
              >
                Flush sessions
              </button>
            </div>
          </div>
        </div>

        {/* Right Side (2 columns): Forms and Lists */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Identity Information Details Card */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-900">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold text-slate-200">Account Identity Parameters</h3>
                <p className="text-[10px] text-slate-500">Provide authentic contact specifications for cluster audit reports.</p>
              </div>
              {!isEditingInfo ? (
                <button 
                  onClick={() => setIsEditingInfo(true)}
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-300 rounded text-xs transition-colors cursor-pointer"
                >
                  Edit Profile
                </button>
              ) : (
                <div className="flex gap-2">
                  <button 
                    onClick={handleCancelEdit}
                    className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 text-slate-400 rounded text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSaveInfo}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition-colors cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>

            {!isEditingInfo ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                <div className="space-y-1 bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Full Name</p>
                  <p className="text-sm font-semibold text-slate-200 mt-1">{name}</p>
                </div>
                <div className="space-y-1 bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Username</p>
                  <p className="text-sm font-mono text-slate-200 mt-1">@{username}</p>
                </div>
                <div className="space-y-1 bg-slate-900/40 p-3 rounded-lg border border-slate-850 md:col-span-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Email Address</p>
                  <p className="text-sm font-semibold text-slate-200 mt-1 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-slate-500" />
                    {email}
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveInfo} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Full Name</label>
                  <input
                    type="text"
                    required
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Username</label>
                  <input
                    type="text"
                    required
                    value={tempUsername}
                    onChange={(e) => setTempUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-mono"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Email Address</label>
                  <input
                    type="email"
                    required
                    value={tempEmail}
                    onChange={(e) => setTempEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </form>
            )}

            {/* Change Password Prompt */}
            <div className="mt-4 pt-4 border-t border-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-indigo-950/15 p-4 rounded-lg border border-indigo-500/10">
              <div className="space-y-0.5">
                <p className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-indigo-400" />
                  Operator Password Security
                </p>
                <p className="text-[10px] text-slate-500">Update system password regularly to maintain API connection privileges.</p>
              </div>
              <button 
                id="change-password-trigger-btn"
                onClick={() => setShowPasswordModal(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-3 rounded text-[11px] transition-colors cursor-pointer self-start sm:self-center"
              >
                Change Password
              </button>
            </div>
          </div>

          {/* Active Terminal Sessions (Audit logs) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Active Terminal Sessions</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">List of devices currently authenticated and authorized to dispatch orders.</p>
            </div>

            <div className="space-y-3">
              {sessions.map(sess => (
                <div 
                  key={sess.id}
                  className="flex items-start justify-between gap-4 p-4 bg-slate-900 rounded-lg border border-slate-850 hover:border-slate-800 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-slate-950 rounded border border-slate-800 text-indigo-400 mt-0.5 shrink-0">
                      <Laptop className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200">{sess.device}</span>
                        <span className="text-[9px] font-mono text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                          {sess.ip}
                        </span>
                        {sess.current && (
                          <span className="text-[9px] font-mono bg-emerald-950/50 text-emerald-400 border border-emerald-900/30 px-1.5 py-0.5 rounded">
                            CURRENT SESSION
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        System: {sess.os} • Browser: {sess.browser}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1 font-mono">
                        <Globe className="w-3 h-3 text-slate-600" /> {sess.location} • Active: {sess.lastActive}
                      </p>
                    </div>
                  </div>

                  {!sess.current && (
                    <button 
                      onClick={() => handleRevokeSession(sess.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/5 rounded border border-transparent hover:border-rose-950 transition-all cursor-pointer"
                      title="Terminate session access"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* API Access Tokens & Developer Keys */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold text-slate-200">Personal API Access Keys</h3>
                <p className="text-[10px] text-slate-500">Automate trading workloads using developer token endpoints.</p>
              </div>
              <button
                onClick={() => {
                  setGeneratedKey(null);
                  setShowNewKeyModal(true);
                }}
                className="bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-200 font-bold py-1 px-3 rounded text-xs flex items-center gap-1 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-400" /> Issue Key
              </button>
            </div>

            <div className="space-y-3">
              {apiKeys.map(k => (
                <div 
                  key={k.id}
                  className="p-3.5 bg-slate-900 rounded-lg border border-slate-850 flex items-center justify-between gap-4 font-mono text-[11px]"
                >
                  <div className="space-y-1">
                    <p className="font-sans font-bold text-slate-200 text-xs">{k.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-indigo-400 select-all font-semibold">{k.tokenPrefix}</span>
                      <span className="text-[9px] text-slate-600 font-sans">• Issued: {k.createdAt}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 shrink-0 font-sans text-xs">
                    <span className="text-[10px] text-slate-500 font-mono">Used: {k.lastUsed}</span>
                    <button 
                      onClick={() => handleRevokeApiKey(k.id)}
                      className="text-slate-500 hover:text-rose-400 cursor-pointer"
                      title="Revoke access key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* Change Password Modal Overlay */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Key className="w-4 h-4 text-indigo-400" />
                Change System Password
              </h3>
              <button 
                onClick={() => setShowPasswordModal(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleChangePasswordSubmit} className="p-6 space-y-4">
              
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 pr-10"
                    placeholder="Min. 8 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                  placeholder="Re-type new password"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                >
                  Update Credentials
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* Issue API Key Modal Overlay */}
      {showNewKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Key className="w-4 h-4 text-indigo-400" />
                Issue Developer API Access Token
              </h3>
              <button 
                onClick={() => setShowNewKeyModal(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {generatedKey ? (
              <div className="p-6 space-y-4">
                <div className="p-4 bg-indigo-950/25 border border-indigo-500/10 rounded-lg text-xs leading-relaxed text-indigo-300">
                  <p className="font-bold text-indigo-200 mb-1 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Token Issued Successfully!
                  </p>
                  Copy this key now. For your security, this key is never shown again once this modal is closed.
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Developer Access Secret</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedKey}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-indigo-400 font-mono select-all font-bold"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedKey);
                        showToast('success', 'Token copied to clipboard');
                      }}
                      className="px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-md cursor-pointer transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800 flex justify-end">
                  <button
                    onClick={() => setShowNewKeyModal(false)}
                    className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors text-xs cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateApiKey} className="p-6 space-y-4">
                
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Access Token Name</label>
                  <input
                    type="text"
                    required
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Terminal Webhook Integration"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowNewKeyModal(false)}
                    className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer"
                  >
                    Generate Secret
                  </button>
                </div>

              </form>
            )}

          </div>
        </div>
      )}

      {/* MFA Setup Modal Overlay */}
      {showMfaSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Lock className="w-4 h-4 text-indigo-400" />
                Configure MFA Protection
              </h3>
              <button 
                onClick={() => setShowMfaSetupModal(false)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {mfaError && (
                <div className="p-3 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-lg text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{mfaError}</span>
                </div>
              )}

              {mfaSetupData ? (
                <form onSubmit={handleVerifySetupSubmit} className="space-y-4">
                  <p className="text-xs text-slate-400 text-center leading-relaxed">
                    Scan this QR code using an authenticator app (like Google Authenticator or Duo) and enter the 6-digit verification code below.
                  </p>

                  <div className="bg-white p-2.5 rounded-xl w-44 h-44 mx-auto flex items-center justify-center shadow-lg border border-slate-200">
                    <img 
                      src={mfaSetupData.qrCodeDataUrl} 
                      alt="MFA QR Code" 
                      className="w-full h-full"
                    />
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-center space-y-1">
                    <p className="text-[9px] text-slate-500 uppercase font-mono tracking-wider font-bold">Manual Setup Key</p>
                    <div className="flex items-center justify-center gap-2">
                      <span className="font-mono text-xs text-slate-300 font-bold select-all">{mfaSetupData.tempSecret}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(mfaSetupData.tempSecret);
                          setCopiedSecret(true);
                          setTimeout(() => setCopiedSecret(false), 2000);
                        }}
                        className="p-1 hover:bg-slate-900 rounded border border-transparent hover:border-slate-850 text-slate-400 hover:text-indigo-400 transition-all cursor-pointer"
                      >
                        {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold text-center block">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      pattern="\d{6}"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000 000"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 text-center text-lg font-bold font-mono tracking-[0.5em] pl-[0.5em] text-indigo-400 focus:outline-hidden focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex justify-end gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowMfaSetupModal(false)}
                      className="px-4 py-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-md font-semibold text-slate-300 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={mfaLoading || mfaCode.length !== 6}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {mfaLoading ? 'Verifying...' : 'Verify & Enable'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="py-12 text-center space-y-3">
                  <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-500 font-mono">Generating key pair credentials...</p>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
