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
      is_active: true,
    });
    await manualSymbol.save();
    console.log(`[AccountInitializer] Created MANUAL placeholder symbol for user ${userId}`);
  }

  // ── Manual Deployment per predefined account ─────────────────────────────
  for (const account of createdAccounts) {
    const existingDep = await Deployment.findOne({
      user_id: userId,
      strategy_id: manualStrategy._id,
      account_id: account._id,
      instrument_token: "MANUAL",
    });

    if (!existingDep) {
      const dep = new Deployment({
        user_id: userId,
        strategy_id: manualStrategy._id,
        account_id: account._id,
        user_symbol_id: manualSymbol._id,
        instrument_token: "MANUAL",
        symbol: "MANUAL",
        start_time: new Date(),
        current_status: "RUNNING",
        strategy_mode: "PAPER",
        deployment_name: `Manual`,
        notes: "Auto-created deployment for manual account operations (deposits, withdrawals, transfers, manual trades).",
      });
      await dep.save();
      console.log(`[AccountInitializer] Created Manual deployment for account ${account.account_name} (user ${userId})`);
    }
  }
};

