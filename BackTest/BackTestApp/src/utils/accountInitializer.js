import mongoose from "mongoose";
import Account from "../models/account.js";
import Strategy from "../models/strategy.js";
import Broker from "../models/broker.js";
import UserSymbol from "../models/userSymbol.js";
import Deployment from "../models/deployment.js";
import {
  MANUAL_INSTRUMENT_TOKEN,
  MANUAL_STRATEGY_NAME,
  MANUAL_SYMBOL,
  MANUAL_DEPLOYMENT_NAME,
} from "./constants.js";

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

  const accountTypesToFind = predefinedAccounts.map((acc) => acc.account_type);
  const existingAccounts = await Account.find({
    user_id: userId,
    account_type: { $in: accountTypesToFind },
  });

  const existingAccountsMap = new Map();
  for (const acc of existingAccounts) {
    if (!existingAccountsMap.has(acc.account_type)) {
      existingAccountsMap.set(acc.account_type, acc);
    }
  }

  const createdAccounts = [];
  const accountsToInsert = [];

  for (const acc of predefinedAccounts) {
    const existing = existingAccountsMap.get(acc.account_type);
    if (existing) {
      createdAccounts.push(existing);
    } else {
      const newAccount = new Account({ ...acc, user_id: userId });
      accountsToInsert.push(newAccount);
      createdAccounts.push(newAccount);
    }
  }

  if (accountsToInsert.length > 0) {
    await Account.insertMany(accountsToInsert);
    for (const acc of accountsToInsert) {
      console.log(`[AccountInitializer] Initialized predefined ${acc.account_type} account for user ${userId}`);
    }
  }

  // ── Manual Strategy + symbol + deployments ───────────────────────────────
  const { manualStrategy, manualSymbol } = await ensureManualStrategyAndSymbol(userId);

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

export async function ensureManualStrategyAndSymbol(userId, { session } = {}) {
  if (!userId) return { manualStrategy: null, manualSymbol: null };

  let manualStrategy = await findWithSession(
    Strategy,
    { user_id: userId, strategy_name: MANUAL_STRATEGY_NAME },
    session
  );
  if (!manualStrategy) {
    manualStrategy = new Strategy({
      user_id: userId,
      strategy_name: MANUAL_STRATEGY_NAME,
      strategy_description: "Predefined manual trading strategy",
      is_active: true,
    });
    if (session) {
      await manualStrategy.save({ session });
    } else {
      await manualStrategy.save();
    }
  }

  let manualSymbol = await findWithSession(
    UserSymbol,
    { user_id: userId, instrument_token: MANUAL_INSTRUMENT_TOKEN },
    session
  );
  if (!manualSymbol) {
    manualSymbol = new UserSymbol({
      user_id: userId,
      instrument_token: MANUAL_INSTRUMENT_TOKEN,
      symbol: MANUAL_SYMBOL,
      symbol_name: "Manual Operations",
      exchange: "NSE",
      description: "Placeholder symbol for manual account operations",
      instrument_class: "EQUITY",
      strike_price_diff: 1,
      is_active: true,
    });
    if (session) {
      await manualSymbol.save({ session });
    } else {
      await manualSymbol.save();
    }
  }

  return { manualStrategy, manualSymbol };
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
      { user_id: userId, strategy_name: MANUAL_STRATEGY_NAME },
      session
    );
  }
  if (!strategy) return null;

  let symbol = manualSymbol;
  if (!symbol) {
    symbol = await findWithSession(
      UserSymbol,
      { user_id: userId, instrument_token: MANUAL_INSTRUMENT_TOKEN },
      session
    );
  }
  if (!symbol) return null;

  let manualDeployment = await findWithSession(
    Deployment,
    {
      user_id: userId,
      account_id: accountDoc._id,
      deployment_name: MANUAL_DEPLOYMENT_NAME,
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
    instrument_token: MANUAL_INSTRUMENT_TOKEN,
    symbol: MANUAL_SYMBOL,
    start_time: new Date(),
    current_status: "RUNNING",
    strategy_mode: accountDoc.account_type === "LIVE" ? "LIVE" : "PAPER",
    deployment_name: MANUAL_DEPLOYMENT_NAME,
    notes:
      "Auto-created deployment for manual account operations (deposits, withdrawals, transfers, manual trades).",
  });

  if (session) {
    try {
      await manualDeployment.save({ session });
    } catch (err) {
      if (err.code === 11000) {
        return findWithSession(
          Deployment,
          {
            user_id: userId,
            account_id: accountDoc._id,
            deployment_name: MANUAL_DEPLOYMENT_NAME,
          },
          session
        );
      }
      throw err;
    }
  } else {
    try {
      await manualDeployment.save();
    } catch (err) {
      if (err.code === 11000) {
        return findWithSession(
          Deployment,
          {
            user_id: userId,
            account_id: accountDoc._id,
            deployment_name: MANUAL_DEPLOYMENT_NAME,
          },
          session
        );
      }
      throw err;
    }
  }
  console.log(
    `[AccountInitializer] Created Manual deployment for account ${accountDoc.account_name} (user ${userId})`
  );
  return manualDeployment;
}

