/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Lock, Mail, User, Cpu, AlertCircle, ArrowRight, Sparkles,
  Smartphone, ArrowLeft, Copy, Check, ShieldCheck
} from 'lucide-react';
import { api } from '../api';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

type LoginViewState = 'login' | 'signup' | 'mfa_verify' | 'mfa_setup';

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [view, setView] = useState<LoginViewState>('login');
  
  // Credentials & profile
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  
  // MFA states
  const [totpCode, setTotpCode] = useState('');
  const [mfaSetupData, setMfaSetupData] = useState<{ otpauthUrl: string; qrCodeDataUrl: string; tempSecret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [setupVerified, setSetupVerified] = useState(false);

  // Status & loading
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived state to keep compatibility with old logic
  const isLogin = view === 'login';

  // Fetch MFA Setup details when transitioning to mfa_setup
  useEffect(() => {
    if (view === 'mfa_setup' && !mfaSetupData) {
      const fetchMfaSetup = async () => {
        try {
          setError(null);
          const data = await api.mfa.setup();
          setMfaSetupData(data);
        } catch (err: any) {
          setError(err.message || 'Failed to initiate MFA setup.');
        }
      };
      fetchMfaSetup();
    }
  }, [view, mfaSetupData]);

  // Main login/signup submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (view === 'login') {
        const data = await api.auth.login(email, password);
        if (data.mfaRequired) {
          setView('mfa_verify');
          setLoading(false);
          return;
        }

        // Login succeeded, now check if MFA is already set up
        const userRes = await api.auth.getMe();
        if (!userRes.data.is_mfa_enabled) {
          setView('mfa_setup');
          setLoading(false);
          return;
        }

        onLoginSuccess();
      } else if (view === 'signup') {
        await api.auth.signup(name, email, username, password);
        // After signup, api.auth.signup automatically logs in. Check setup status.
        const userRes = await api.auth.getMe();
        if (!userRes.data.is_mfa_enabled) {
          setView('mfa_setup');
          setLoading(false);
          return;
        }
        
        onLoginSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Verify MFA token for logging in
  const handleMfaVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length < 6) {
      setError('Please enter a valid 6-digit code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.mfa.loginVerify(email, password, totpCode);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Invalid MFA code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Confirm and activate MFA setup
  const handleMfaSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length < 6) {
      setError('Please enter the 6-digit confirmation code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.mfa.verifySetup(totpCode);
      setSetupVerified(true);
      setTimeout(() => {
        onLoginSuccess();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (emailVal: string, passVal: string) => {
    setEmail(emailVal);
    setPassword(passVal);
    setView('login');
    setError(null);
  };

  const copyToClipboard = () => {
    if (mfaSetupData?.tempSecret) {
      navigator.clipboard.writeText(mfaSetupData.tempSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleBackToLogin = () => {
    setView('login');
    setError(null);
    setTotpCode('');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-black flex items-center justify-center p-4 font-sans select-none">
      
      {/* Dynamic Background Glowing Blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl -z-10 animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl -z-10 animate-pulse delay-75" />

      <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-8 shadow-2xl relative">
        
        {/* Error notification */}
        {error && (
          <div className="mb-6 p-3.5 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-lg text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. Login / Sign Up Form */}
        {(view === 'login' || view === 'signup') && (
          <>
            {/* Title header */}
            <div className="text-center space-y-2 mb-8">
              <div className="inline-flex p-3 bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-indigo-400 mb-2">
                <Cpu className="w-6 h-6 animate-spin-slow" />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight flex items-center justify-center gap-1.5">
                MoneyMaker <span className="text-indigo-400 text-sm font-mono font-bold bg-indigo-950 px-2 py-0.5 rounded border border-indigo-900">BackTest</span>
              </h1>
              <p className="text-xs text-slate-400">
                {isLogin ? 'Sign in to access your quantitative analytics engine' : 'Create an account to deploy custom algorithms'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {view === 'signup' && (
                <>
                  {/* Full name input */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Username input */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Username</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="johndoe"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Email input */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Password input */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Security Key / Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-650 focus:outline-hidden focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 disabled:opacity-50 mt-6"
              >
                {loading ? 'Verifying Credentials...' : isLogin ? 'Access Console' : 'Initialize Account'}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>

            {/* Form switcher */}
            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setView(view === 'login' ? 'signup' : 'login');
                  setError(null);
                }}
                className="text-xs text-slate-400 hover:text-indigo-400 transition-colors font-medium cursor-pointer"
              >
                {view === 'login' ? "Don't have an account? Sign up" : 'Already have credentials? Sign in'}
              </button>
            </div>

            {/* Quick Credential Shortcuts */}
            {view === 'login' && (
              <div className="mt-8 pt-6 border-t border-slate-800/80">
                <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold text-center mb-3.5 flex items-center justify-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Developer Seed Profiles
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleQuickFill('admin@moneymaker.com', 'adminpassword123')}
                    className="bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-left transition-colors cursor-pointer group"
                  >
                    <span className="text-[10px] font-bold text-slate-200 block group-hover:text-indigo-400 transition-colors">Admin Profile</span>
                    <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">admin@moneymaker.com</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickFill('user@moneymaker.com', 'userpassword123')}
                    className="bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-left transition-colors cursor-pointer group"
                  >
                    <span className="text-[10px] font-bold text-slate-200 block group-hover:text-indigo-400 transition-colors">Standard User</span>
                    <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">user@moneymaker.com</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* 2. MFA Verification Form (Login challenge) */}
        {view === 'mfa_verify' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-indigo-400 mb-2">
                <Smartphone className="w-6 h-6 animate-pulse" />
              </div>
              <h2 className="text-xl font-black text-white tracking-tight">Two-Factor Authentication</h2>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                For additional security, please enter the 6-digit validation code from your authenticator app.
              </p>
            </div>

            <form onSubmit={handleMfaVerifySubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold block text-center">
                  Verification Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  pattern="\d{6}"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000 000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 text-center text-xl font-bold font-mono tracking-[0.5em] pl-[0.5em] text-indigo-400 placeholder-slate-800 focus:outline-hidden focus:border-indigo-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 disabled:opacity-50"
              >
                {loading ? 'Authenticating...' : 'Verify & Log In'}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>

            <div className="text-center">
              <button
                onClick={handleBackToLogin}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to credentials sign-in
              </button>
            </div>
          </div>
        )}

        {/* 3. MFA Setup Form (Enrollment) */}
        {view === 'mfa_setup' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-indigo-400 mb-2">
                <Lock className="w-6 h-6 text-indigo-400" />
              </div>
              <h2 className="text-xl font-black text-white tracking-tight">Protect Your Account</h2>
              <p className="text-xs text-slate-400">
                Configure Multi-Factor Authentication to secure your trading algorithms.
              </p>
            </div>

            {setupVerified ? (
              <div className="py-6 text-center space-y-3">
                <div className="inline-flex p-3 bg-emerald-950 border border-emerald-500/20 rounded-full text-emerald-400 animate-bounce">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <p className="text-sm font-bold text-slate-200">MFA Configured Successfully!</p>
                <p className="text-xs text-slate-500">Redirecting to terminal dashboard...</p>
              </div>
            ) : (
              <>
                {mfaSetupData ? (
                  <div className="space-y-5">
                    {/* QR Code Container */}
                    <div className="bg-white p-3 rounded-xl w-48 h-48 mx-auto flex items-center justify-center shadow-lg border border-slate-200">
                      <img 
                        src={mfaSetupData.qrCodeDataUrl} 
                        alt="MFA QR Code" 
                        className="w-full h-full"
                      />
                    </div>

                    {/* Manual entry key block */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center space-y-1.5">
                      <p className="text-[9px] text-slate-500 uppercase font-mono tracking-wider font-bold">Manual Setup Secret</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-mono text-xs text-slate-300 font-bold select-all">{mfaSetupData.tempSecret}</span>
                        <button
                          type="button"
                          onClick={copyToClipboard}
                          className="p-1 hover:bg-slate-900 rounded border border-transparent hover:border-slate-800 text-slate-400 hover:text-indigo-400 transition-all cursor-pointer"
                          title="Copy setup secret"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <form onSubmit={handleMfaSetupSubmit} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold text-center block">
                          Enter 6-Digit Code to Confirm
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          pattern="\d{6}"
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="000 000"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 text-center text-lg font-bold font-mono tracking-[0.5em] pl-[0.5em] text-indigo-400 focus:outline-hidden focus:border-indigo-500 transition-colors"
                        />
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={onLoginSuccess}
                          className="flex-1 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors text-center"
                        >
                          Skip for now
                        </button>
                        <button
                          type="submit"
                          disabled={loading || totpCode.length !== 6}
                          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {loading ? 'Verifying...' : 'Verify & Enable'}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="py-12 text-center space-y-3">
                    <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-mono">Generating secure key pairs...</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
