import { MANUAL_DEPLOYMENT_NAME } from "./constants.js";

/**
 * Each deployment mode runs on exactly one account type:
 *   LIVE     -> LIVE account (always linked to an external broker; real orders)
 *   PAPER    -> PAPER account (internal broker; live market data, no broker orders)
 *   BACKTEST -> SIMULATION account (internal broker; historical replay)
 * The UI mirrors this map in BackTestUI/src/utils/deploymentMode.ts.
 */
export const ACCOUNT_TYPE_FOR_MODE = Object.freeze({
  LIVE: "LIVE",
  PAPER: "PAPER",
  BACKTEST: "SIMULATION",
});

export const MODE_FOR_ACCOUNT_TYPE = Object.freeze({
  LIVE: "LIVE",
  PAPER: "PAPER",
  SIMULATION: "BACKTEST",
});

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/** Deployment mode that belongs to an account type (used for the Manual deployment). */
export function modeForAccountType(accountType) {
  const mode = MODE_FOR_ACCOUNT_TYPE[accountType];
  if (!mode) {
    throw badRequest(`Unknown account type ${JSON.stringify(accountType)}`);
  }
  return mode;
}

/** True when the deployment mode and the account type form an allowed pair. */
export function isAccountTypeAllowedForMode(strategyMode, accountType) {
  const required = ACCOUNT_TYPE_FOR_MODE[strategyMode];
  return Boolean(required) && required === accountType;
}

/**
 * Throws a 400 when the account cannot host a deployment of this mode.
 * `account` needs `account_type`; `broker` (optional) needs `is_internal`.
 */
export function assertAccountMatchesMode(strategyMode, account, broker = null) {
  const required = ACCOUNT_TYPE_FOR_MODE[strategyMode];
  if (!required) {
    throw badRequest(
      `strategy_mode must be one of ${Object.keys(ACCOUNT_TYPE_FOR_MODE).join(", ")}`
    );
  }
  if (!account || account.account_type !== required) {
    throw badRequest(
      `A ${strategyMode} deployment needs a ${required} account; ` +
        `the selected account is ${account?.account_type || "unknown"}.`
    );
  }
  if (strategyMode === "LIVE" && broker && broker.is_internal) {
    throw badRequest("A LIVE deployment needs an account linked to an external broker.");
  }
}

/** The system-created per-account deployment for deposits, withdrawals and manual trades. */
export function isManualDeployment(deployment) {
  return Boolean(deployment) && deployment.deployment_name === MANUAL_DEPLOYMENT_NAME;
}

/**
 * Backtest deployments keep their own Redis balance (account_balance:<deploymentId>)
 * so parallel runs on one SIMULATION account do not collide. The Manual deployment
 * is bookkeeping for the account itself, so it always uses the account-level key.
 */
export function usesDeploymentScopedBalance(deployment) {
  return deployment?.strategy_mode === "BACKTEST" && !isManualDeployment(deployment);
}
