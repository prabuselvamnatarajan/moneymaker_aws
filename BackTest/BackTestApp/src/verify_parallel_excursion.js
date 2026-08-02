import mongoose from "mongoose";
import app from "./app.js"; // Ensures all schemas are registered
import { connectDB } from "./db/connection.js";
import Deployment from "./models/deployment.js";
import Account from "./models/account.js";
import Trade from "./models/trade.js";
import Position from "./models/position.js";
import Ledger from "./models/ledger.js";
import { transitionDeployment } from "./services/deployment.js";
import { createClient } from "redis";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const monitorCompletion = async (depId1, depId2) => {
  console.log("Monitoring progress of parallel backtests via MongoDB status...");
  
  while (true) {
    await sleep(1500);
    const d1 = await Deployment.findById(depId1);
    const d2 = await Deployment.findById(depId2);
    
    const count1 = await Trade.countDocuments({ deployment_id: depId1 });
    const count2 = await Trade.countDocuments({ deployment_id: depId2 });
    
    console.log(`  Varata 1 trades: ${count1} (status: ${d1?.current_status}) | Varata 2 trades: ${count2} (status: ${d2?.current_status})`);
    
    if (d1?.current_status === "STOPPED" && d2?.current_status === "STOPPED") {
      console.log("Both backtests transitioned to STOPPED!");
      break;
    }
  }
};

const run = async () => {
  await connectDB();
  
  const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
  const redisClient = createClient({ url: redisUrl });
  await redisClient.connect();
  
  // Find Varata 2 to get userId and other references
  const dep2 = await Deployment.findOne({ deployment_name: "Varata 2" });
  if (!dep2) {
    console.error("Varata 2 deployment not found!");
    process.exit(1);
  }
  
  const userId = dep2.user_id;

  // 1. Setup/Reset Account for Varata 2
  let account2 = await Account.findById(dep2.account_id);
  if (!account2) {
    account2 = new Account({
      _id: dep2.account_id,
      account_name: "Admin Paper",
      account_type: "SIMULATION",
      initial_balance: 25000000,
      current_balance: 25000000,
      user_id: userId,
    });
  } else {
    account2.current_balance = 25000000;
    account2.initial_balance = 25000000;
  }
  await account2.save();

  // 2. Setup/Reset Account for Varata 1
  let account1 = await Account.findOne({ account_name: "Varata 1 Account" });
  if (account1) {
    account1.current_balance = 25000000;
    account1.initial_balance = 25000000;
    await account1.save();
  } else {
    account1 = new Account({
      account_name: "Varata 1 Account",
      account_type: "SIMULATION",
      initial_balance: 25000000,
      current_balance: 25000000,
      user_id: userId,
    });
    await account1.save();
  }

  // 3. Find/Reset Varata 1 deployment to use account1
  let dep1 = await Deployment.findOne({ deployment_name: "Varata 1" });
  if (!dep1) {
    console.error("Varata 1 deployment not found! Recreating it...");
    const { _id, deployment_id, created_at, updated_at, deployment_name, ...rest } = dep2.toObject();
    const newId = new mongoose.Types.ObjectId();
    dep1 = new Deployment({
      ...rest,
      _id: newId,
      deployment_id: newId.toString(),
      deployment_name: "Varata 1",
      account_id: account1._id,
      current_status: "STOPPED",
      backtest_speed: 15,
      backtest_date: "2026-08-01",
    });
    await dep1.save();
  } else {
    dep1.account_id = account1._id;
    dep1.current_status = "STOPPED";
    dep1.backtest_speed = 15;
    dep1.backtest_date = "2026-08-01";
    await dep1.save();
  }

  // Make sure Varata 2 status is STOPPED to start fresh
  dep2.current_status = "STOPPED";
  dep2.backtest_speed = 15;
  dep2.backtest_date = "2026-08-01";
  await dep2.save();

  // 4. Delete old trades/positions/ledgers for both deployments
  await Trade.deleteMany({ deployment_id: { $in: [dep1._id, dep2._id] } });
  await Position.deleteMany({ deployment_id: { $in: [dep1._id, dep2._id] } });
  await Ledger.deleteMany({ deployment_id: { $in: [dep1._id, dep2._id] } });
  
  // Clean up Redis keys for both
  await redisClient.del(`account_balance:${dep1.deployment_id}`);
  await redisClient.del(`account_balance:${dep2.deployment_id}`);
  await redisClient.del(`bought_quantity:${dep1.deployment_id}`);
  await redisClient.del(`bought_quantity:${dep2.deployment_id}`);
  await redisClient.del(`sold_quantity:${dep1.deployment_id}`);
  await redisClient.del(`sold_quantity:${dep2.deployment_id}`);
  
  console.log("Setup clean. Starting parallel backtests now...");
  
  // 5. Start both deployments concurrently
  await Promise.all([
    transitionDeployment(userId, dep1._id, "start"),
    transitionDeployment(userId, dep2._id, "start"),
  ]);
  
  // 6. Monitor completion
  await monitorCompletion(dep1._id, dep2._id);
  
  // 7. Stop both deployments if not already stopped
  const d1Final = await Deployment.findById(dep1._id);
  const d2Final = await Deployment.findById(dep2._id);
  await Promise.all([
    d1Final?.current_status !== "STOPPED" ? transitionDeployment(userId, dep1._id, "stop") : Promise.resolve(),
    d2Final?.current_status !== "STOPPED" ? transitionDeployment(userId, dep2._id, "stop") : Promise.resolve(),
  ]);
  
  // 8. Fetch and compare positions side-by-side
  const positions1 = await Position.find({ deployment_id: dep1._id }).sort({ opened_at: 1 });
  const positions2 = await Position.find({ deployment_id: dep2._id }).sort({ opened_at: 1 });
  
  console.log("\n=================================================");
  console.log(`Varata 1 positions: ${positions1.length} | Varata 2 positions: ${positions2.length}`);
  console.log("=================================================");
  
  let mismatchCount = 0;
  const matchLen = Math.min(positions1.length, positions2.length);
  for (let i = 0; i < matchLen; i++) {
    const p1 = positions1[i];
    const p2 = positions2[i];
    const maxUpMatch = p1.max_up === p2.max_up;
    const maxDownMatch = p1.max_down === p2.max_down;
    
    if (!maxUpMatch || !maxDownMatch) {
      mismatchCount++;
      console.log(`Position [${i}] MISMATCH:`);
      console.log(`  V1: entry=${p1.average_entry_price} max_up=${p1.max_up} max_down=${p1.max_down} status=${p1.status}`);
      console.log(`  V2: entry=${p2.average_entry_price} max_up=${p2.max_up} max_down=${p2.max_down} status=${p2.status}`);
    }
  }
  
  if (positions1.length !== positions2.length) {
    console.log(`❌ Mismatch in position count! V1: ${positions1.length}, V2: ${positions2.length}`);
  } else if (mismatchCount === 0) {
    console.log("🎉 SUCCESS: All position max_up and max_down match perfectly!");
  } else {
    console.log(`❌ FAILED: Found ${mismatchCount} mismatched positions.`);
  }
  
  await redisClient.disconnect();
  process.exit(0);
};

run().catch(e => {
  console.error("Execution failed:", e);
  process.exit(1);
});
