import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

// Load root .env if CLIENT_ID/UPSTOX_CLIENT_ID was not loaded from current directory
if (!process.env.CLIENT_ID && !process.env.UPSTOX_CLIENT_ID) {
  dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}
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
import Broker from "../models/broker.js";
import ExternalBrokerId from "../models/externalBrokerId.js";
import { syncAllDeploymentsToRedis } from "../services/deployment.js";

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
    
    // Clear collections and drop indexes by dropping them
    const collectionsToDrop = [
      "users", "accounts", "brokers", "external_broker_ids", "strategies",
      "usersymbols", "deployments", "trades", "ledgers", "permissions", "roles"
    ];
    for (const name of collectionsToDrop) {
      try {
        await mongoose.connection.db.dropCollection(name);
      } catch (e) {
        // Collection might not exist yet, safe to ignore
      }
    }
    
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
      email: "admin@cobratrades.com",
      password: hashedAdminPassword,
      name: "Admin User",
      roles: [adminRole._id],
      is_active: true
    });
    await adminUser.save();

    const hashedUserPassword = await bcrypt.hash("userpassword123", 10);
    const standardUser = new User({
      username: "standarduser",
      email: "user@cobratrades.com",
      password: hashedUserPassword,
      name: "Standard User",
      roles: [userRole._id],
      is_active: true
    });
    await standardUser.save();
    console.log("Created users.");

    // Seed external broker ids
    const upstoxExt = new ExternalBrokerId({ external_broker_id: "upstox" });
    await upstoxExt.save();
    console.log("Created external broker IDs.");

    // Seed brokers
    const internalBroker = new Broker({ name: "Cobra Trades", is_internal: true });
    await internalBroker.save();

    const interactiveBroker = new Broker({ name: "Interactive Brokers" });
    await interactiveBroker.save();

    const zerodhaBroker = new Broker({ name: "Zerodha" });
    await zerodhaBroker.save();

    // Seed user-specific Upstox brokers with real credentials from environment or empty placeholders
    const defaultUpstoxRedirectUri = process.env.UPSTOX_REDIRECT_URI || process.env.REDIRECT_URI || "http://localhost/logedin";
    const rawClientId = (process.env.UPSTOX_CLIENT_ID || process.env.CLIENT_ID || "").trim();
    const rawClientSecret = (process.env.UPSTOX_CLIENT_SECRET || process.env.CLIENT_SECRET || "").trim();

    const isDummy = (val) => typeof val === "string" && (val.toLowerCase().startsWith("dummy") || val.toLowerCase() === "dummy");
    const safeClientId = isDummy(rawClientId) ? "" : rawClientId;
    const safeClientSecret = isDummy(rawClientSecret) ? "" : rawClientSecret;

    const upstoxBrokerAdmin = new Broker({
      name: "Upstox",
      is_internal: false,
      user_id: adminUser._id.toString(),
      external_broker_id: "upstox",
      credentials: {
        client_id: safeClientId,
        client_secret: safeClientSecret,
        redirect_uri: defaultUpstoxRedirectUri
      },
      access_token: ""
    });
    await upstoxBrokerAdmin.save();

    const upstoxBrokerStandard = new Broker({
      name: "Upstox",
      is_internal: false,
      user_id: standardUser._id.toString(),
      external_broker_id: "upstox",
      credentials: {
        client_id: safeClientId,
        client_secret: safeClientSecret,
        redirect_uri: defaultUpstoxRedirectUri
      },
      access_token: ""
    });
    await upstoxBrokerStandard.save();

    console.log("Created brokers (including Upstox user-specific configurations).");

    // 4. Create accounts
    const accountsData = [
      {
        user_id: standardUser._id,
        account_name: "simulation",
        account_type: "SIMULATION",
        initial_balance: 10000000,
        current_balance: 10002500,
        description: "Primary simulation environment for testing strategies",
        is_active: true,
        broker_id: internalBroker._id
      },
      {
        user_id: standardUser._id,
        account_name: "Test 1",
        account_type: "PAPER",
        initial_balance: 5000000,
        current_balance: 5000000,
        description: "Secondary paper trading account",
        is_active: true,
        broker_id: internalBroker._id
      },
      {
        user_id: adminUser._id,
        account_name: "Admin Live",
        account_type: "LIVE",
        initial_balance: 25000000,
        current_balance: 25000000,
        description: "Admin production trading account",
        is_active: true,
        broker_id: zerodhaBroker._id
      },
      {
        user_id: adminUser._id,
        account_name: "Admin Paper",
        account_type: "PAPER",
        initial_balance: 7500000,
        current_balance: 7500000,
        description: "Admin paper testing account",
        is_active: true,
        broker_id: internalBroker._id
      }
    ];
    const seededAccounts = await Account.insertMany(accountsData);
    console.log(`Created ${seededAccounts.length} accounts.`);

    const { initializeUserAccounts } = await import("../utils/accountInitializer.js");
    await initializeUserAccounts(standardUser._id);
    await initializeUserAccounts(adminUser._id);
    console.log("Initialized Manual strategy/symbol/deployments for seeded users.");

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
      },
      {
        user_id: standardUser._id,
        strategy_name: "liquidity_sweep",
        strategy_description: "Tick-level liquidity sweep and absorption reversal strategy using order flow delta.",
        is_active: true,
        params: {
          burstMultiplier: 2.5,
          deltaThresholdMultiplier: 1.5,
          minRR: 2.0,
          maxRR: 3.0,
          accountRiskPerTrade: 0.0075,
          cooldownMinutes: 5,
          openingRangeMinutes: 15,
          hvnWindowMinutes: 45,
          entryOnNextTick: true,
          lowConfidenceDeltaWeight: 0.5,
          bookImbalanceThreshold: 0.55,
          trailOffsetR: 0.5,
          maxConcurrentTrades: 1,
        }
      }
    ];
    const seededStrategies = await Strategy.insertMany(strategiesData);
    console.log(`Created ${seededStrategies.length} strategies.`);

    // 6. Create watchlisted user symbols
    const symbolsData = [
      { user_id: standardUser._id, instrument_token: "NSE_INDEX|Nifty 50", symbol: "NSE_INDEX|Nifty 50", symbol_name: "Nifty 50", exchange: "NSE", is_active: true, description: "Nifty 50 Index", instrument_class: "INDEX", strike_price_diff: 50 },
      { user_id: standardUser._id, instrument_token: "NSE_INDEX|Nifty Bank", symbol: "NSE_INDEX|Nifty Bank", symbol_name: "Nifty Bank", exchange: "NSE", is_active: true, description: "Nifty Bank Index", instrument_class: "INDEX", strike_price_diff: 100 },
      { user_id: adminUser._id, instrument_token: "NSE_INDEX|Nifty 50", symbol: "NSE_INDEX|Nifty 50", symbol_name: "Nifty 50", exchange: "NSE", is_active: true, description: "Nifty 50 Index", instrument_class: "INDEX", strike_price_diff: 50 },
      { user_id: adminUser._id, instrument_token: "NSE_INDEX|Nifty Bank", symbol: "NSE_INDEX|Nifty Bank", symbol_name: "Nifty Bank", exchange: "NSE", is_active: true, description: "Nifty Bank Index", instrument_class: "INDEX", strike_price_diff: 100 }
    ];
    const seededSymbols = await UserSymbol.insertMany(symbolsData);
    console.log(`Created ${seededSymbols.length} user symbols.`);

    // 7. Create deployments
    const standardSimAcc = seededAccounts.find(a => a.account_name === "simulation" && a.user_id.equals(standardUser._id));
    const standardPaperAcc = seededAccounts.find(a => a.account_name === "Test 1" && a.user_id.equals(standardUser._id));
    
    const meanReversionStrat = seededStrategies.find(s => s.strategy_name === "Mean Reversion v4" && s.user_id.equals(standardUser._id));
    const momentumStrat = seededStrategies.find(s => s.strategy_name === "Momentum Scalper" && s.user_id.equals(standardUser._id));
    const gridStrat = seededStrategies.find(s => s.strategy_name === "Grid Bot Alpha" && s.user_id.equals(standardUser._id));
    
    const nifty50Symbol = seededSymbols.find(sym => sym.symbol.toUpperCase() === "NSE_INDEX|NIFTY 50" && sym.user_id.equals(standardUser._id));
    const niftyBankSymbol = seededSymbols.find(sym => sym.symbol.toUpperCase() === "NSE_INDEX|NIFTY BANK" && sym.user_id.equals(standardUser._id));

    const deploymentsData = [
      {
        user_id: standardUser._id,
        strategy_id: meanReversionStrat._id,
        account_id: standardSimAcc._id,
        user_symbol_id: nifty50Symbol._id,
        instrument_token: "NSE_INDEX|Nifty 50",
        symbol: "NSE_INDEX|Nifty 50",
        start_time: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        current_status: "RUNNING",
        strategy_mode: "LIVE",
        deployment_name: "Mean Reversion v4 (live)",
        notes: "Running live simulation for audit check"
      },
      {
        user_id: standardUser._id,
        strategy_id: momentumStrat._id,
        account_id: standardSimAcc._id,
        user_symbol_id: niftyBankSymbol._id,
        instrument_token: "NSE_INDEX|Nifty Bank",
        symbol: "NSE_INDEX|Nifty Bank",
        start_time: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        current_status: "RUNNING",
        strategy_mode: "PAPER",
        deployment_name: "Momentum Scalper (live)",
        notes: "Trading on quick hourly trends"
      },
      {
        user_id: standardUser._id,
        strategy_id: gridStrat._id,
        account_id: standardPaperAcc._id,
        user_symbol_id: nifty50Symbol._id,
        instrument_token: "NSE_INDEX|Nifty 50",
        symbol: "NSE_INDEX|Nifty 50",
        start_time: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
        current_status: "PAUSED",
        strategy_mode: "BACKTEST",
        deployment_name: "Grid Bot Alpha",
        notes: "Grid bounds need readjustment"
      }
    ];
    const seededDeployments = await Deployment.insertMany(deploymentsData);
    console.log(`Created ${seededDeployments.length} deployments.`);

    // 8. Create some sample trades and ledgers to generate yield history
    const nifty50Deployment = seededDeployments.find(d => d.symbol.toUpperCase() === "NSE_INDEX|NIFTY 50");
    
    // Trade 1: Buy
    const buyTrade = new Trade({
      deployment_id: nifty50Deployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      account_id: standardSimAcc._id,
      user_symbol_id: nifty50Symbol._id,
      instrument_token: "NSE_INDEX|Nifty 50",
      symbol: "NSE_INDEX|Nifty 50",
      price: 24300,
      quantity: 50,
      type_of_order: "BUY",
      status: "EXECUTED",
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      execution_time: new Date(Date.now() - 2 * 60 * 60 * 1000)
    });
    await buyTrade.save();

    const buyLedger = new Ledger({
      account_id: standardSimAcc._id,
      trade_id: buyTrade._id,
      deployment_id: nifty50Deployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      user_symbol_id: nifty50Symbol._id,
      change_in_balance: -1215000,
      opening_balance: 10000000,
      closing_balance: 8785000,
      symbol: "NSE_INDEX|Nifty 50",
      order_type: "BUY",
      quantity: 50,
      price: 24300,
      created_on: new Date(Date.now() - 2 * 60 * 60 * 1000)
    });
    await buyLedger.save();

    // Trade 2: Sell at profit
    const sellTrade = new Trade({
      deployment_id: nifty50Deployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      account_id: standardSimAcc._id,
      user_symbol_id: nifty50Symbol._id,
      instrument_token: "NSE_INDEX|Nifty 50",
      symbol: "NSE_INDEX|Nifty 50",
      price: 24350,
      quantity: 50,
      type_of_order: "SELL",
      status: "EXECUTED",
      created_at: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      execution_time: new Date(Date.now() - 1 * 60 * 60 * 1000)
    });
    await sellTrade.save();

    const sellLedger = new Ledger({
      account_id: standardSimAcc._id,
      trade_id: sellTrade._id,
      deployment_id: nifty50Deployment._id,
      user_id: standardUser._id,
      strategy_id: meanReversionStrat._id,
      user_symbol_id: nifty50Symbol._id,
      change_in_balance: 1217500,
      opening_balance: 8785000,
      closing_balance: 10002500,
      symbol: "NSE_INDEX|Nifty 50",
      order_type: "SELL",
      quantity: 50,
      price: 24350,
      created_on: new Date(Date.now() - 1 * 60 * 60 * 1000)
    });
    await sellLedger.save();

    console.log("Created trade and ledger yield history.");
    await syncAllDeploymentsToRedis();
    const { syncOrgAccessTokenIfAdmin } = await import("../services/broker.js");
    await syncOrgAccessTokenIfAdmin();
    console.log("✅ Database clear and seed completed successfully!");
  } catch (error) {
    console.error("❌ Clear and seed failed:", error);
    throw error;
  }
};

if (process.argv[1] && process.argv[1].endsWith("clear_and_seed.js")) {
  connectDB()
    .then(clearAndSeedDB)
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error(error);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
