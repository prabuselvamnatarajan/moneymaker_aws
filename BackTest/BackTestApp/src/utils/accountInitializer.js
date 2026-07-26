import mongoose from "mongoose";
import Account from "../models/account.js";
import Strategy from "../models/strategy.js";
import Broker from "../models/broker.js";
import UserSymbol from "../models/userSymbol.js";
import Deployment from "../models/deployment.js";

/**
 * Initializes predefined accounts (paper and simulation), strategies, and
 * a "Manual" deployment for each account for a new user.
 * This function is idempotent — safe to call multiple times.
 * @param {string|mongoose.Types.ObjectId} userId - The user's ID.
 */
export const initializeUserAccounts = async (userId) => {
  if (!userId) return;

  let internalBroker = await Broker.findOne({ is_internal: true });
  if (!internalBroker) {
    internalBroker = await Broker.create({ name: "Cobra Trades", is_internal: true });
  }

  const predefinedAccounts = [
    {
      account_name: "paper",
      account_type: "PAPER",
      initial_balance: 100000,
      current_balance: 100000,
      description: "Predefined paper trading account",
      is_active: true,
      broker_id: internalBroker._id,
    },
    {
      account_name: "simulation",
      account_type: "SIMULATION",
      initial_balance: 100000,
      current_balance: 100000,
      description: "Predefined simulation trading account",
      is_active: true,
      broker_id: internalBroker._id,
    }
  ];

  const createdAccounts = [];
  for (const acc of predefinedAccounts) {
    let account = await Account.findOne({
      user_id: userId,
      account_type: acc.account_type
    });

    if (!account) {
      account = new Account({ ...acc, user_id: userId });
      await account.save();
      console.log(`[AccountInitializer] Initialized predefined ${acc.account_type} account for user ${userId}`);
    }
    createdAccounts.push(account);
  }

  // ── Manual Strategy ───────────────────────────────────────────────
  let manualStrategy = await Strategy.findOne({
    user_id: userId,
    strategy_name: "Manual"
  });

  if (!manualStrategy) {
    manualStrategy = new Strategy({
      user_id: userId,
      strategy_name: "Manual",
      strategy_description: "Predefined manual trading strategy",
      is_active: true
    });
    await manualStrategy.save();
    console.log(`[AccountInitializer] Initialized predefined Manual strategy for user ${userId}`);
  }

  // ── MANUAL placeholder UserSymbol ───────────────────────────────────────
  let manualSymbol = await UserSymbol.findOne({
    user_id: userId,
    instrument_token: "MANUAL"
  });

  if (!manualSymbol) {
    manualSymbol = new UserSymbol({
      user_id: userId,
      instrument_token: "MANUAL",
      symbol: "MANUAL",
      symbol_name: "Manual Operations",
      exchange: "NSE",
      description: "Placeholder symbol for manual account operations",
      instrument_class: "EQUITY",
      strike_price_diff: 1,
      is_active: true,
    });
    await manualSymbol.save();
    console.log(`[AccountInitializer] Created MANUAL placeholder symbol for user ${userId}`);
  }

  // ── Manual Deployment per predefined account ─────────────────────────────
  for (const account of createdAccounts) {
    await ensureManualDeploymentForAccount(userId, account._id, {
      manualStrategy,
      manualSymbol,
      account,
    });
  }
};

async function findWithSession(model, filter, session) {
  const query = model.findOne(filter);
  return session ? query.session(session) : query;
}

/**
 * Ensures a Manual deployment exists for a specific account (any account type).
 * Idempotent — safe inside transactions when session is provided.
 */
export async function ensureManualDeploymentForAccount(
  userId,
  accountId,
  { manualStrategy, manualSymbol, account, session } = {}
) {
  if (!userId || !accountId) return null;

  let accountDoc = account;
  if (!accountDoc) {
    accountDoc = await findWithSession(
      Account,
      mongoose.isValidObjectId(accountId)
        ? { $or: [{ _id: accountId }, { account_id: String(accountId) }] }
        : { account_id: accountId },
      session
    );
  }
  if (!accountDoc || String(accountDoc.user_id) !== String(userId)) {
    return null;
  }

  let strategy = manualStrategy;
  if (!strategy) {
    strategy = await findWithSession(
      Strategy,
      { user_id: userId, strategy_name: "Manual" },
      session
    );
  }
  if (!strategy) return null;

  let symbol = manualSymbol;
  if (!symbol) {
    symbol = await findWithSession(
      UserSymbol,
      { user_id: userId, instrument_token: "MANUAL" },
      session
    );
  }
  if (!symbol) return null;

  let manualDeployment = await findWithSession(
    Deployment,
    {
      user_id: userId,
      account_id: accountDoc._id,
      deployment_name: "Manual",
    },
    session
  );

  if (manualDeployment) {
    return manualDeployment;
  }

  manualDeployment = new Deployment({
    user_id: userId,
    strategy_id: strategy._id,
    account_id: accountDoc._id,
    user_symbol_id: symbol._id,
    instrument_token: "MANUAL",
    symbol: "MANUAL",
    start_time: new Date(),
    current_status: "RUNNING",
    strategy_mode: accountDoc.account_type === "LIVE" ? "LIVE" : "PAPER",
    deployment_name: "Manual",
    notes:
      "Auto-created deployment for manual account operations (deposits, withdrawals, transfers, manual trades).",
  });

  if (session) {
    await manualDeployment.save({ session });
  } else {
    await manualDeployment.save();
  }
  console.log(
    `[AccountInitializer] Created Manual deployment for account ${accountDoc.account_name} (user ${userId})`
  );
  return manualDeployment;
}

