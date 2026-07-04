/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Landmark, ShieldCheck, ShieldAlert, ArrowLeft, TrendingUp, 
  TrendingDown, DollarSign, Wallet, Percent, ArrowUpRight 
} from 'lucide-react';
import { Account, Transaction, Strategy } from '../types';
import TransactionList from './TransactionList';

import { api } from '../api';

interface AccountDetailsViewProps {
  account: Account;
  accounts: Account[];
  transactions: Transaction[];
  strategies: Strategy[];
  onBackToDashboard: () => void;
  onToggleBrokerStatus: (accountId: string) => void;
  onSelectTransaction: (tx: Transaction) => void;
  onDrilldownToTransactions: (filterKey: 'accountId', filterValue: string) => void;
  timezone: string;
  onRefreshData?: () => void;
}

export default function AccountDetailsView({
  account,
  accounts,
  transactions,
  strategies,
  onBackToDashboard,
  onToggleBrokerStatus,
  onSelectTransaction,
  onDrilldownToTransactions,
  timezone,
  onRefreshData,
}: AccountDetailsViewProps) {

  // Filter transactions belonging to this account
  const filteredTxs = transactions.filter((tx) => tx.accountId === account.id);

  // Form states for ledger balance management
  const [manageType, setManageType] = React.useState<'DEPOSIT' | 'WITHDRAW' | 'TRANSFER'>('DEPOSIT');
  const [amount, setAmount] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [targetAccountId, setTargetAccountId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Reconstruct active positions from transaction history
  const calculatedPositions = React.useMemo(() => {
    const tradeTxs = filteredTxs.filter((tx) => tx.transactionType === 'TRADE');
    const assetGroups: Record<string, { size: number; totalCost: number }> = {};

    const sortedTrades = [...tradeTxs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    sortedTrades.forEach((tx) => {
      const symbol = tx.symbol || 'UNKNOWN';
      const qty = tx.quantity || 0;
      const price = tx.price || 0;
      const isBuy = tx.type === 'BUY';

      if (!assetGroups[symbol]) {
        assetGroups[symbol] = { size: 0, totalCost: 0 };
      }

      const group = assetGroups[symbol];

      if (isBuy) {
        const newSize = group.size + qty;
        if (newSize > 0) {
          group.totalCost = (group.totalCost * group.size + price * qty) / newSize;
        } else {
          group.totalCost = 0;
        }
        group.size = newSize;
      } else {
        const newSize = group.size - qty;
        if (newSize <= 0) {
          group.totalCost = 0;
          group.size = 0;
        } else {
          group.size = newSize;
        }
      }
    });

    return Object.keys(assetGroups)
      .map((ticker) => {
        const group = assetGroups[ticker];
        const currentPrice = 100.0; // Fallback price
        const marketValue = group.size * currentPrice;
        const totalCost = group.size * group.totalCost;
        const pnl = parseFloat((marketValue - totalCost).toFixed(2));

        return {
          ticker,
          size: group.size,
          avgEntry: parseFloat(group.totalCost.toFixed(2)),
          currentPrice,
          marketValue: parseFloat(marketValue.toFixed(2)),
          pnl,
        };
      })
      .filter((pos) => pos.size > 0);
  }, [filteredTxs]);

  const handleBalanceManage = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Please specify a valid numeric amount greater than zero.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      if (manageType === 'DEPOSIT') {
        await api.ledger.deposit(account.id, val, description);
        setSuccessMsg(`Successfully deposited ₹${val.toLocaleString()} to ${account.name}.`);
      } else if (manageType === 'WITHDRAW') {
        await api.ledger.withdraw(account.id, val, description);
        setSuccessMsg(`Successfully withdrew ₹${val.toLocaleString()} from ${account.name}.`);
      } else if (manageType === 'TRANSFER') {
        if (!targetAccountId) {
          setErrorMsg('Please select a destination account.');
          setLoading(false);
          return;
        }
        await api.ledger.transfer(account.id, targetAccountId, val, description);
        setSuccessMsg(`Successfully transferred ₹${val.toLocaleString()} to destination account.`);
      }

      setAmount('');
      setDescription('');
      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Ledger action failed');
    } finally {
      setLoading(false);
    }
  };

  const getMockPositions = () => {
    if (account.id === 'ACC-001') {
      return [
        { ticker: 'NSE_INDEX|Nifty 50', size: 50, avgEntry: 24300.00, currentPrice: 24350.00, marketValue: 1217500, pnl: 2500 },
        { ticker: 'NSE_INDEX|Nifty Bank', size: 25, avgEntry: 52000.00, currentPrice: 52100.00, marketValue: 1302500, pnl: 2500 },
      ];
    } else if (account.id === 'ACC-002') {
      return [
        { ticker: 'NSE_INDEX|Nifty 50', size: 50, avgEntry: 24300.00, currentPrice: 24350.00, marketValue: 1217500, pnl: 2500 },
      ];
    } else if (account.id === 'ACC-003') {
      return [
        { ticker: 'NSE_INDEX|Nifty Bank', size: 25, avgEntry: 52000.00, currentPrice: 52100.00, marketValue: 1302500, pnl: 2500 },
      ];
    }
    return [];
  };

  const positions = calculatedPositions.length > 0 ? calculatedPositions : getMockPositions();
  const isPositive = account.pnl >= 0;
  const isConnected = account.status === 'connected';

  return (
    <div className="space-y-6">
      
      {/* Back button and breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
        <button
          onClick={onBackToDashboard}
          className="flex items-center gap-1 hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
        <span>/</span>
        <span className="text-slate-400 font-mono font-normal">Accounts</span>
        <span>/</span>
        <span className="text-slate-200 font-bold">{account.name}</span>
      </div>

      {/* Main Header Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-6 rounded-xl border border-slate-800 font-sans">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 rounded-lg text-indigo-400 border border-slate-800">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">{account.name}</h2>
              <p className="text-xs text-slate-500 font-mono">{account.broker} • System Link ID: {account.id}</p>
            </div>
          </div>
        </div>

        {/* Connection Switcher */}
        <div className="flex items-center gap-4 bg-slate-900 p-3 rounded-lg border border-slate-800">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            )}
            <span className={`text-xs font-bold font-mono ${isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isConnected ? 'API FEED ENCRYPTED' : 'FEED LINK TERMINATED'}
            </span>
          </div>

          <button
            id={`acc-toggle-broker-btn-${account.id}`}
            onClick={() => onToggleBrokerStatus(account.id)}
            className={`px-3 py-1.5 rounded text-xs font-mono font-bold border transition-colors cursor-pointer ${
              isConnected 
                ? 'bg-rose-950/40 text-rose-400 border-rose-900 hover:bg-rose-950' 
                : 'bg-emerald-600 text-white border-transparent hover:bg-emerald-500'
            }`}
          >
            {isConnected ? 'Revoke API' : 'Authorize API'}
          </button>
        </div>
      </div>

      {/* Valuation Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 font-sans">
        
        {/* Net Liquidation Assets */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Net Liquid Asset Valuation</p>
          <p className="text-xl font-black font-mono text-slate-100 mt-1.5">
            ₹{account.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <span className="text-[10px] text-slate-500 mt-1.5 block">Settled currency: <strong className="font-mono text-slate-400">{account.currency}</strong></span>
        </div>

        {/* Leverage / Buying Power */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Available Margin (Leverage)</p>
          <p className="text-xl font-bold font-mono text-slate-100 mt-1.5">
            ₹{account.margin.toLocaleString()}
          </p>
          <span className="text-[10px] text-slate-500 mt-1.5 block">Risk threshold: <strong className="font-mono text-slate-400">4.0x Ratio</strong></span>
        </div>

        {/* Realized Ledger Yield */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Realized Capital Yield</p>
          <p className={`text-xl font-bold font-mono mt-1.5 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? '+' : ''}₹{account.pnl.toLocaleString()}
          </p>
          <span className="text-[10px] text-slate-500 mt-1.5 block">Based on initial equity block: <strong className="font-mono text-slate-400">₹{account.initialBalance.toLocaleString()}</strong></span>
        </div>

        {/* Growth Ratio */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Equity Growth Factor</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-xl font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {((account.pnl / account.initialBalance) * 100).toFixed(2)}%
            </span>
            <span className="p-0.5 rounded-sm bg-indigo-500/10 text-indigo-400 text-[10px] font-mono font-semibold">
              YTD
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1.5 block">Audit verified return</span>
        </div>

        {/* Broker Commission */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">Broker Commission Setup</p>
          <p className="text-xl font-bold font-mono text-indigo-400 mt-1.5">
            {account.commissionRate !== undefined 
              ? (account.commissionType === 'FLAT' ? `₹${account.commissionRate}` : `${account.commissionRate}%`)
              : '0.00%'}
          </p>
          <span className="text-[10px] text-slate-500 mt-1.5 block">
            Charge model: <strong className="font-mono text-slate-400">{account.commissionType === 'FLAT' ? 'Flat Fee' : 'Percentage-based'}</strong>
          </span>
        </div>
      </div>

      {/* Active Portfolio Positions & Balance Management Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
        {/* Active Portfolio Positions holdings table (2 columns) */}
        <div className="lg:col-span-2 bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Active Live Portfolio Positions</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Aggregated security inventory currently exposed in the market.</p>
          </div>

          {positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans divide-y divide-slate-850 border border-slate-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-900/50 text-slate-500 uppercase font-semibold font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Asset</th>
                    <th className="p-3 text-right">Size</th>
                    <th className="p-3 text-right">Avg Cost</th>
                    <th className="p-3 text-right">Current Price</th>
                    <th className="p-3 text-right">Market Value</th>
                    <th className="p-3 text-right">Unrealized profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {positions.map((pos) => {
                    const posGain = pos.pnl >= 0;
                    return (
                      <tr key={pos.ticker} className="hover:bg-indigo-600/5 transition-colors">
                        <td className="p-3 font-bold font-mono text-slate-200">{pos.ticker}</td>
                        <td className="p-3 text-right text-slate-300 font-mono">{pos.size}</td>
                        <td className="p-3 text-right text-slate-400 font-mono">₹{pos.avgEntry.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right text-slate-200 font-mono">₹{pos.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right text-slate-300 font-mono font-semibold">₹{pos.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className={`p-3 text-right font-mono font-bold ${posGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {posGain ? '+' : ''}₹{pos.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 bg-slate-900/10 border border-slate-800/40 rounded-lg">
              <p className="text-xs font-semibold">No active exposed positions currently loaded</p>
              <p className="text-[11px] text-slate-600 mt-1">
                {isConnected ? 'No strategy signals have deployed inventory allocation yet.' : 'Please authorize the broker API first to fetch active inventories.'}
              </p>
            </div>
          )}
        </div>

        {/* Balance Management Console (1 column) */}
        <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Balance Management</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Modify account equity blocks via deposit, withdraw, or transfer.</p>
            </div>

            {successMsg && (
              <div className="p-3 bg-emerald-950/70 border border-emerald-500/30 text-[11px] text-emerald-400 rounded-lg">
                {successMsg}
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-rose-950/70 border border-rose-500/30 text-[11px] text-rose-400 rounded-lg">
                {errorMsg}
              </div>
            )}

            {/* Toggle tabs for Deposit / Withdraw / Transfer */}
            <div className="grid grid-cols-3 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              {(['DEPOSIT', 'WITHDRAW', 'TRANSFER'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setManageType(t);
                    setSuccessMsg(null);
                    setErrorMsg(null);
                  }}
                  className={`py-1.5 rounded-md text-[10px] font-mono font-bold transition-all ${
                    manageType === t 
                      ? 'bg-indigo-600 text-white' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <form onSubmit={handleBalanceManage} className="space-y-3.5 text-xs text-slate-300">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Amount (INR)</label>
                <input
                  type="number"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              {manageType === 'TRANSFER' && (
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Destination Account</label>
                  <select
                    value={targetAccountId}
                    onChange={(e) => setTargetAccountId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="">Select Account...</option>
                    {accounts.filter(a => a.id !== account.id).map(a => (
                      <option key={a.id} value={a.id}>{a.name} (₹{a.balance.toLocaleString()})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-semibold">Description / Remarks</label>
                <input
                  type="text"
                  placeholder="e.g. Weekly funding allocation"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-md p-2 text-slate-200 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                {loading ? 'Processing...' : `Execute ${manageType.toLowerCase()}`}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Transactions list section */}
      <div className="pt-4 border-t border-slate-800 font-sans">
        <TransactionList
          transactions={filteredTxs}
          accounts={[account]}
          strategies={strategies}
          variant="compact"
          timezone={timezone}
          onRowClick={onSelectTransaction}
          onViewAllDrilldown={() => onDrilldownToTransactions('accountId', account.id)}
        />
      </div>

    </div>
  );
}
