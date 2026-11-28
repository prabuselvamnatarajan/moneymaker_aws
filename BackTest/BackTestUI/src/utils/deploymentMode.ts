import type { Account } from '../types';

export type DeploymentMode = 'live' | 'paper' | 'backtest';
export type AccountType = 'LIVE' | 'PAPER' | 'SIMULATION';

/**
 * Each deployment mode runs on exactly one account type. The server enforces the
 * same map in BackTestApp/src/utils/deploymentMode.js; keep the two in step.
 */
export const ACCOUNT_TYPE_FOR_MODE: Readonly<Record<DeploymentMode, AccountType>> = Object.freeze({
  live: 'LIVE',
  paper: 'PAPER',
  backtest: 'SIMULATION',
});

export const MODE_LABEL: Readonly<Record<DeploymentMode, string>> = Object.freeze({
  live: 'Live',
  paper: 'Paper',
  backtest: 'Backtest',
});

export function isAccountAllowedForMode(account: Pick<Account, 'accountType'> | undefined, mode: DeploymentMode): boolean {
  return Boolean(account) && account!.accountType === ACCOUNT_TYPE_FOR_MODE[mode];
}

/** Accounts a deployment of this mode may use, in their original order. */
export function accountsForMode<T extends Pick<Account, 'accountType'>>(accounts: T[], mode: DeploymentMode): T[] {
  return accounts.filter((acc) => isAccountAllowedForMode(acc, mode));
}

/**
 * Error to show on the create-deployment form, or null when the pair is valid.
 * Mirrors the server's 400 so the user sees the reason before submitting.
 */
export function deploymentAccountError(
  account: Pick<Account, 'accountType' | 'name'> | undefined,
  mode: DeploymentMode,
): string | null {
  const required = ACCOUNT_TYPE_FOR_MODE[mode];
  if (!account) {
    return `Select a ${required} account for a ${MODE_LABEL[mode]} deployment.`;
  }
  if (account.accountType !== required) {
    return `${MODE_LABEL[mode]} deployments need a ${required} account; "${account.name}" is ${account.accountType ?? 'of unknown type'}.`;
  }
  return null;
}
