/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, Mail, User, Cpu, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import { api } from '../api';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        await api.auth.login(email, password);
      } else {
        await api.auth.signup(name, email, username, password);
      }
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (emailVal: string, passVal: string) => {
    setEmail(emailVal);
    setPassword(passVal);
    setIsLogin(true);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-black flex items-center justify-center p-4 font-sans select-none">
      
      {/* Dynamic Background Glowing Blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl -z-10 animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl -z-10 animate-pulse delay-75" />

      <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-8 shadow-2xl relative">
        
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

        {/* Error notification */}
        {error && (
          <div className="mb-6 p-3.5 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-lg text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {!isLogin && (
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
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="text-xs text-slate-400 hover:text-indigo-400 transition-colors font-medium cursor-pointer"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an credentials? Sign in'}
          </button>
        </div>

        {/* Quick Credential Shortcuts */}
        {isLogin && (
          <div className="mt-8 pt-6 border-t border-slate-800/80">
            <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold text-center mb-3.5 flex items-center justify-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Developer Seed Profiles
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleQuickFill('admin@moneymaker.com', 'admin123')}
                className="bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-left transition-colors cursor-pointer group"
              >
                <span className="text-[10px] font-bold text-slate-200 block group-hover:text-indigo-400 transition-colors">Admin Profile</span>
                <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">admin@moneymaker.com</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('user@moneymaker.com', 'user123')}
                className="bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-left transition-colors cursor-pointer group"
              >
                <span className="text-[10px] font-bold text-slate-200 block group-hover:text-indigo-400 transition-colors">Standard User</span>
                <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">user@moneymaker.com</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
