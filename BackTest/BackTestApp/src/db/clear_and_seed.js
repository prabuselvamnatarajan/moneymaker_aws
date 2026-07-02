import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "./connection.js";
import User from "../models/user.js";
import Account from "../models/account.js";
import Strategy from "../models/strategy.js";
import UserSymbol from "../models/userSymbol.js";
import Deployment from "../models/deployment.js";
import Trade from "../models/trade.js";
import Ledger from "../models/ledger.js";

const PermissionSchema = new mongoose.Schema({
  operation: { type: String, required: true },
  entity: { type: String, required: true },
  description: { type: String, default: "" }
}, { timestamps: true });

const RoleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Permission" }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const Permission = mongoose.models.Permission || mongoose.model("Permission", PermissionSchema);
const Role = mongoose.models.Role || mongoose.model("Role", RoleSchema);

export const clearAndSeedDB = async () => {
  try {
    console.log("🧹 Wiping all collections...");
    
    // Clear collections
    await User.deleteMany({});
    await Account.deleteMany({});
    await Strategy.deleteMany({});
    await UserSymbol.deleteMany({});
    await Deployment.deleteMany({});
    await Trade.deleteMany({});
    await Ledger.deleteMany({});
    await Permission.deleteMany({});
    await Role.deleteMany({});
    
    // Clear sessions
    if (mongoose.connection.db.collection("sessions")) {
      try {
        await mongoose.connection.db.collection("sessions").deleteMany({});
        console.log("Cleared sessions collection.");
      } catch (err) {
        console.log("No sessions collection to clear.");
      }
    }

    console.log("🌱 Database wiped. Beginning seed...");

    // 1. Create permissions
    const permissionsData = [
      { operation: "read", entity: "users", description: "Read user profiles" },
      { operation: "write", entity: "users", description: "Manage user profiles" },
      { operation: "read", entity: "accounts", description: "Read accounts" },
      { operation: "write", entity: "accounts", description: "Manage accounts" },
      { operation: "read", entity: "strategies", description: "Read strategies" },
      { operation: "write", entity: "strategies", description: "Manage strategies" },
      { operation: "read", entity: "symbols", description: "Read symbols" },
      { operation: "write", entity: "symbols", description: "Manage symbols" },
      { operation: "read", entity: "deployments", description: "Read deployments" },
      { operation: "write", entity: "deployments", description: "Manage deployments" },
      { operation: "read", entity: "trades", description: "Read trades" },
      { operation: "write", entity: "trades", description: "Execute trades" },
      { operation: "read", entity: "ledger", description: "Read ledger" }
    ];

    const seededPermissions = await Permission.insertMany(permissionsData);
    console.log(`Created ${seededPermissions.length} permissions.`);

    // 2. Create roles
    const adminRole = new Role({
      name: "admin",
      description: "Administrator role",
      permissions: seededPermissions.map(p => p._id)
    });
    await adminRole.save();

    const userPerms = seededPermissions.filter(p => p.entity !== "users");
    const userRole = new Role({
      name: "user",
      description: "Standard user role",
      permissions: userPerms.map(p => p._id)
    });
    await userRole.save();
    console.log("Created roles.");

    // 3. Create users
    const hashedAdminPassword = await bcrypt.hash("adminpassword123", 10);
    const adminUser = new User({
      username: "admin",
      email: "admin@moneymaker.com",
      password: hashedAdminPassword,
      name: "Admin User",
      roles: [adminRole._id],
      is_active: true
    });
    await adminUser.save();

    const hashedUserPassword = await bcrypt.hash("userpassword123", 10);
    const standardUser = new User({
      username: "standarduser",
      email: "user@moneymaker.com",
      password: hashedUserPassword,
      name: "Standard User",
      roles: [userRole._id],
      is_active: true
    });
    await standardUser.save();
    console.log("Created users.");

    // 4. Create accounts
    const accountsData = [
      {
        user_id: standardUser._id,
        account_name: "simulation",
        account_type: "SIMULATION",
        initial_balance: 100000,
        current_balance: 100500,
        description: "Primary simulation environment for testing strategies",
        is_active: true
      },
      {
        user_id: standardUser._id,
        account_name: "Test 1",
        account_type: "PAPER",
        initial_balance: 50000,
        current_balance: 50000,
        description: "Secondary paper trading account",
        is_active: true
      },
      {
        user_id: adminUser._id,
        account_name: "Admin Live",
        account_type: "LIVE",
        initial_balance: 250000,
        current_balance: 250000,
        description: "Admin production trading account",
        is_active: true
      },
      {
        user_id: adminUser._id,
        account_name: "Admin Paper",
        account_type: "PAPER",
        initial_balance: 75000,
        current_balance: 75000,
        description: "Admin paper testing account",
        is_active: true
      }
    ];
    const seededAccounts = await Account.insertMany(accountsData);
    console.log(`Created ${seededAccounts.length} accounts.`);

    // 5. Create strategies
    const strategiesData = [
      {
        user_id: standardUser._id,
        strategy_name: "Mean Reversion v4",
        strategy_description: "Detects overbought/oversold levels and enters counter-trend positions.",
        is_active: true
      },
      {
        user_id: standardUser._id,
        strategy_name: "Momentum Scalper",
        strategy_description: "Scalps quick breakouts along the primary trend direction.",
        is_active: true
      },
      {
        user_id: standardUser._id,
        strategy_name: "Grid Bot Alpha",
        strategy_description: "Maintains a grid of buy/sell orders around a stable price pivot.",
        is_active: true
      },
      {
        user_id: adminUser._id,
        strategy_name: "Arbitrage HFT",
        strategy_description: "High-frequency triangular arbitrage scanner.",
        is_active: true
      },
      {
        user_id: adminUser._id,
        strategy_name: "Breakout Rider",
        strategy_description: "Rides large macro breakout trends.",
        is_active: true
      }
    ];
    const seededStrategies = await Strategy.insertMany(strategiesData);
    console.log(`Created ${seededStrategies.length} strategies.`);

    // 6. Create watchlisted user symbols
    const symbolsData = [
      { user_id: standardUser._id, instrument_token: "BTC-USD", symbol: "BTC/USD", exchange: "NSE", is_active: true },
      { user_id: standardUser._id, instrument_token: "AAPL", symbol: "AAPL", exchange: "NSE", is_active: true },
      { user_id: standardUser._id, instrument_token: "EUR-USD", symbol: "EUR/USD", exchange: "NSE", is_active: true },
      { user_id: standardUser._id, instrument_token: "TSLA", symbol: "TSLA", exchange: "NSE", is_active: true },
      { user_id: adminUser._id, instrument_token: "BTC-USD", symbol: "BTC/USD", exchange: "NSE", is_active: true },
      { user_id: adminUser._id, instrument_token: "AAPL", symbol: "AAPL", exchange: "NSE", is_active: true }
    ];
    const seededSymbols = await UserSymbol.insertMany(symbolsData);
    console.log(`Created ${seededSymbols.length} user symbols.`);

    // 7. Create deployments
    const standardSimAcc = seededAccounts.find(a => a.account_name === "simulation" && a.user_id.equals(standardUser._id));
    const standardPaperAcc = seededAccounts.find(a => a.account_name === "Test 1" && a.user_id.equals(standardUser._id));
    
    const meanReversionStrat = seededStrategies.find(s => s.strategy_name === "Mean Reversion v4" && s.user_id.equals(standardUser._id));
    const momentumStrat = seededStrategies.find(s => s.strategy_name === "Momentum Scalper" && s.user_id.equals(standardUser._id));
    const gridStrat = seededStrategies.find(s => s.strategy_name === "Grid Bot Alpha" && s.user_id.equals(standardUser._id));
    
    const btcSymbol = seededSymbols.find(sym => sym.symbol === "BTC/USD" && sym.user_id.equals(standardUser._id));
    const aaplSymbol = seededSymbols.find(sym => sym.symbol === "AAPL" && sym.user_id.equals(standardUser._id));
    const eurSymbol = seededSymbols.find(sym => sym.symbol === "EUR/USD" && sym.user_id.equals(standardUser._id));

    const deploymentsData = [
      {
        user_id: standardUser._id,
        strategy_id: meanReversionStrat._id,
        account_id: standardSimAcc._id,
        user_symbol_id: btcSymbol._id,
        instrument_token: "BTC-USD",
        symbol: "BTC/USD",
        start_time: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        current_status: "RUNNING",
        strategy_mode: "TEST",
        deployment_name: "Mean Reversion v4 (live)",
        notes: "Running live simulation for audit check"
      },
      {
        user_id: standardUser._id,
        strategy_id: momentumStrat._id,
        account_id: standardSimAcc._id,
        user_symbol_id: aaplSymbol._id,
        instrument_token: "AAPL",
        symbol: "AAPL",
        start_time: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        current_status: "RUNNING",
        strategy_mode: "TEST",
        deployment_name: "Momentum Scalper (live)",
        notes: "Trading on quick hourly trends"
      },
      {
        user_id: standardUser._id,
        strategy_id: gridStrat._id,
        account_id: standardPaperAcc._id,
        user_symbol_id: eurSymbol._id,
        instrument_token: "EUR-USD",
        symbol: "EUR/USD",
        start_time: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
        current_status: "PAUSED",
        strategy_mode: "TEST",
        deployment_name: "Grid Bot Alpha",
        notes: "Grid bounds need readjustment"
      }
    ];
    const seededDeployments = await Deployment.insertMany(deploymentsData);
    console.log(`Created ${seededDeployments.length} deployments.`);

    // 8. Create some sample trades and ledgers to generate yield history
    const btcDeployment = seededDeployments.find(d => d.symbol === "BTC/USD");
    
    // Trade 1: Buy
    const buyTrade = new Trade({
      deployment_id: btcDeployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      account_id: standardSimAcc._id,
      user_symbol_id: btcSymbol._id,
      instrument_token: "BTC-USD",
      symbol: "BTC/USD",
      price: 100,
      quantity: 10,
      type_of_order: "BUY",
      status: "EXECUTED",
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      execution_time: new Date(Date.now() - 2 * 60 * 60 * 1000)
    });
    await buyTrade.save();

    const buyLedger = new Ledger({
      account_id: standardSimAcc._id,
      trade_id: buyTrade._id,
      deployment_id: btcDeployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      user_symbol_id: btcSymbol._id,
      change_in_balance: -1000,
      opening_balance: 100000,
      closing_balance: 99000,
      symbol: "BTC/USD",
      order_type: "BUY",
      quantity: 10,
      price: 100,
      created_on: new Date(Date.now() - 2 * 60 * 60 * 1000)
    });
    await buyLedger.save();

    // Trade 2: Sell at profit
    const sellTrade = new Trade({
      deployment_id: btcDeployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      account_id: standardSimAcc._id,
      user_symbol_id: btcSymbol._id,
      instrument_token: "BTC-USD",
      symbol: "BTC/USD",
      price: 150,
      quantity: 10,
      type_of_order: "SELL",
      status: "EXECUTED",
      created_at: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      execution_time: new Date(Date.now() - 1 * 60 * 60 * 1000)
    });
    await sellTrade.save();

    const sellLedger = new Ledger({
      account_id: standardSimAcc._id,
      trade_id: sellTrade._id,
      deployment_id: btcDeployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      user_symbol_id: btcSymbol._id,
      change_in_balance: 1500,
      opening_balance: 99000,
      closing_balance: 100500,
      symbol: "BTC/USD",
      order_type: "SELL",
      quantity: 10,
      price: 150,
      created_on: new Date(Date.now() - 1 * 60 * 60 * 1000)
    });
    await sellLedger.save();

    console.log("Created trade and ledger yield history.");
    console.log("✅ Database clear and seed completed successfully!");
  } catch (error) {
    console.error("❌ Clear and seed failed:", error);
  }
};

if (process.argv[1] && process.argv[1].endsWith("clear_and_seed.js")) {
  connectDB().then(async () => {
    await clearAndSeedDB();
    process.exit(0);
  });
}
