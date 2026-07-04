import Account from "../models/account.js";
import Strategy from "../models/strategy.js";

/**
 * Initializes predefined accounts (paper and simulation) and strategies for a new user.
 * @param {string|mongoose.Types.ObjectId} userId - The user's ID.
 */
export const initializeUserAccounts = async (userId) => {
  if (!userId) return;

  const predefinedAccounts = [
    {
      account_name: "paper",
      account_type: "PAPER",
      initial_balance: 100000,
      current_balance: 100000,
      description: "Predefined paper trading account",
      is_active: true
    },
    {
      account_name: "simulation",
      account_type: "SIMULATION",
      initial_balance: 100000,
      current_balance: 100000,
      description: "Predefined simulation trading account",
      is_active: true
    }
  ];

  for (const acc of predefinedAccounts) {
    const existing = await Account.findOne({
      user_id: userId,
      account_type: acc.account_type
    });

    if (!existing) {
      const newAccount = new Account({
        ...acc,
        user_id: userId
      });
      await newAccount.save();
      console.log(`[AccountInitializer] Initialized predefined ${acc.account_type} account for user ${userId}`);
    }
  }

  // Predefined Strategy Initialization
  const existingStrat = await Strategy.findOne({
    user_id: userId,
    strategy_name: "Manual Trade"
  });

  if (!existingStrat) {
    const newStrategy = new Strategy({
      user_id: userId,
      strategy_name: "Manual Trade",
      strategy_description: "Predefined manual trading strategy",
      is_active: true
    });
    await newStrategy.save();
    console.log(`[AccountInitializer] Initialized predefined Manual Trade strategy for user ${userId}`);
  }
};
