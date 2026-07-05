import mongoose from "mongoose";
import app from "./app.js"; // Ensures all schemas are registered
import { connectDB } from "./db/connection.js";
import Deployment from "./models/deployment.js";
import Account from "./models/account.js";
import Trade from "./models/trade.js";
import Ledger from "./models/ledger.js";
import Strategy from "./models/strategy.js";
import UserSymbol from "./models/userSymbol.js";
import { transitionDeployment } from "./services/deployment.js";
import { createClient } from "redis";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const monitorDeploymentCompletion = async (deploymentId, redisClient) => {
  console.log(`Monitoring progress of deployment ${deploymentId} via Redis...`);
  const redisKey = `backtest_completed:${deploymentId}`;
  
  // Clean up any stale key first
  await redisClient.del(redisKey);
  
  while (true) {
    await sleep(500);
    const isCompleted = await redisClient.get(redisKey);
    const count = await Trade.countDocuments({ deployment_id: deploymentId });
    console.log(`  Current trades count: ${count}`);
    
    if (isCompleted === "true") {
      console.log(`  Backtest completed signal received in Redis for deployment ${deploymentId}.`);
      await redisClient.del(redisKey);
      break;
    }
  }
};

const run = async () => {
  await connectDB();
  
  const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
  const redisClient = createClient({ url: redisUrl });
  await redisClient.connect();
  console.log("Connected to Redis for completion monitoring.");
  
  const userId = new mongoose.Types.ObjectId("6a49daf9ef7613c949152530"); // user 'meow'
  const strategyId = new mongoose.Types.ObjectId("6a49db5aef7613c9491525b3"); // strategy 'msb'
  const symbol = "NSE_INDEX|Nifty 50";
  const instrumentToken = "NSE_INDEX|Nifty 50";
  const userSymbolId = new mongoose.Types.ObjectId("6a49db36ef7613c9491525a1");

  // 1. Setup two accounts
  let accountA = await Account.findOne({ account_name: "DET_ACCOUNT_A" });
  if (accountA) await Account.deleteOne({ _id: accountA._id });
  accountA = new Account({
    account_name: "DET_ACCOUNT_A",
    account_type: "SIMULATION",
    initial_balance: 100000,
    current_balance: 100000,
    user_id: userId,
  });
  await accountA.save();

  let accountB = await Account.findOne({ account_name: "DET_ACCOUNT_B" });
  if (accountB) await Account.deleteOne({ _id: accountB._id });
  accountB = new Account({
    account_name: "DET_ACCOUNT_B",
    account_type: "SIMULATION",
    initial_balance: 100000,
    current_balance: 100000,
    user_id: userId,
  });
  await accountB.save();

  // 2. Setup two deployments
  let depA = await Deployment.findOne({ deployment_name: "DET_DEP_A" });
  if (depA) await Deployment.deleteOne({ _id: depA._id });
  depA = new Deployment({
    strategy_id: strategyId,
    account_id: accountA._id,
    user_symbol_id: userSymbolId,
    instrument_token: instrumentToken,
    symbol: symbol,
    start_time: new Date(),
    current_status: "STOPPED",
    strategy_mode: "BACKTEST",
    deployment_name: "DET_DEP_A",
    backtest_date: "2026-06-24",
    backtest_speed: 0,
    user_id: userId,
  });
  await depA.save();

  let depB = await Deployment.findOne({ deployment_name: "DET_DEP_B" });
  if (depB) await Deployment.deleteOne({ _id: depB._id });
  depB = new Deployment({
    strategy_id: strategyId,
    account_id: accountB._id,
    user_symbol_id: userSymbolId,
    instrument_token: instrumentToken,
    symbol: symbol,
    start_time: new Date(),
    current_status: "STOPPED",
    strategy_mode: "BACKTEST",
    deployment_name: "DET_DEP_B",
    backtest_date: "2026-06-24",
    backtest_speed: 0,
    user_id: userId,
  });
  await depB.save();

  console.log("Setup completed. Starting backtest A...");
  
  // 3. Start backtest A
  await transitionDeployment(userId, depA._id, "start");
  await monitorDeploymentCompletion(depA._id, redisClient);
  await transitionDeployment(userId, depA._id, "stop");
  
  // Get final state for A
  const finalAccountA = await Account.findById(accountA._id);
  const tradesA = await Trade.find({ deployment_id: depA._id }).sort({ _id: 1 });
  console.log(`Deployment A finished. Total trades: ${tradesA.length}, Final balance: ${finalAccountA.current_balance}`);

  console.log("Starting backtest B...");
  
  // 4. Start backtest B
  await transitionDeployment(userId, depB._id, "start");
  await monitorDeploymentCompletion(depB._id, redisClient);
  await transitionDeployment(userId, depB._id, "stop");
  
  // Get final state for B
  const finalAccountB = await Account.findById(accountB._id);
  const tradesB = await Trade.find({ deployment_id: depB._id }).sort({ _id: 1 });
  console.log(`Deployment B finished. Total trades: ${tradesB.length}, Final balance: ${finalAccountB.current_balance}`);

  // Disconnect Redis
  await redisClient.disconnect();

  // 5. Compare results

  console.log("\n--- Comparison Results ---");
  const balancesMatch = finalAccountA.current_balance === finalAccountB.current_balance;
  const countsMatch = tradesA.length === tradesB.length;
  
  let detailsMatch = true;
  if (countsMatch) {
    for (let i = 0; i < tradesA.length; i++) {
      if (
        tradesA[i].price !== tradesB[i].price ||
        tradesA[i].quantity !== tradesB[i].quantity ||
        tradesA[i].type_of_order !== tradesB[i].type_of_order
      ) {
        detailsMatch = false;
        console.log(`Mismatch at trade index ${i}:`);
        console.log(`  A: ${tradesA[i].type_of_order} ${tradesA[i].quantity} @ ${tradesA[i].price}`);
        console.log(`  B: ${tradesB[i].type_of_order} ${tradesB[i].quantity} @ ${tradesB[i].price}`);
      }
    }
  } else {
    detailsMatch = false;
  }

  console.log(`Trades Count Match: ${countsMatch} (A: ${tradesA.length}, B: ${tradesB.length})`);
  console.log(`Account Closing Balance Match: ${balancesMatch} (A: ${finalAccountA.current_balance}, B: ${finalAccountB.current_balance})`);
  console.log(`Trade Details Match: ${detailsMatch}`);

  if (!countsMatch || !detailsMatch) {
    console.log("\n--- Comparison of First 20 Trades ---");
    const maxLen = Math.max(tradesA.length, tradesB.length);
    for (let i = 0; i < Math.min(20, maxLen); i++) {
      const tA = tradesA[i];
      const tB = tradesB[i];
      console.log(`Trade ${i}:`);
      console.log(`  A: ${tA ? `${tA.type_of_order} ${tA.quantity} @ ${tA.price} (time: ${tA.created_at.toISOString()})` : "N/A"}`);
      console.log(`  B: ${tB ? `${tB.type_of_order} ${tB.quantity} @ ${tB.price} (time: ${tB.created_at.toISOString()})` : "N/A"}`);
    }
  }

  if (countsMatch && balancesMatch && detailsMatch) {
    console.log("🎉 SUCCESS: Sequential backtests are fully deterministic and identical!");
  } else {
    console.log("❌ FAILURE: Non-deterministic behavior detected!");
  }

  // Commented out cleanup to allow manual DB inspection
  /*
  await Account.deleteOne({ _id: accountA._id });
  await Account.deleteOne({ _id: accountB._id });
  await Deployment.deleteOne({ _id: depA._id });
  await Deployment.deleteOne({ _id: depB._id });
  await Trade.deleteMany({ deployment_id: depA._id });
  await Trade.deleteMany({ deployment_id: depB._id });
  await Ledger.deleteMany({ deployment_id: depA._id });
  await Ledger.deleteMany({ deployment_id: depB._id });
  */

  process.exit(0);
};

run();
