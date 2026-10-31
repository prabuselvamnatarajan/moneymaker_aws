import mongoose from "mongoose";
import Account from "../models/account.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";
import { createClient } from "redis";

const USER_UPDATABLE_FIELDS = ["account_name", "description", "is_active", "commission_type", "commission_rate", "broker_id"];
const ADMIN_UPDATABLE_FIELDS = [
  ...USER_UPDATABLE_FIELDS,
  "account_type",
  "current_balance",
  "initial_balance",
];

export const createAccount = async (userId, accountData) => {
  const Broker = mongoose.model("Broker");
  
  if (accountData.account_type === "PAPER" || accountData.account_type === "SIMULATION") {
    if (accountData.broker_id) {
      const requestedBroker = await Broker.findById(accountData.broker_id);
      if (requestedBroker && !requestedBroker.is_internal) {
        throw new Error(
          "Only LIVE accounts can be associated with external brokers. PAPER and SIMULATION accounts must use Cobra Trades broker."
        );
      }
    }
    let internalBroker = await Broker.findOne({ is_internal: true });
    if (!internalBroker) {
      internalBroker = await Broker.create({ name: "Cobra Trades", is_internal: true });
    }
    accountData.broker_id = internalBroker._id;
  }

  const account = new Account({
    ...accountData,
    current_balance: accountData.current_balance !== undefined ? accountData.current_balance : accountData.initial_balance,
    user_id: userId,
  });
  return await account.save();
};

export const getAllAccounts = async (userId, queryParams, isAdmin = false) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "created_on",
    dateField: "created_on",
    searchFields: ["account_name", "description"],
  });

  if (!isAdmin) {
    filter.user_id = userId;
  }



  const items = await Account.find(filter).sort(sort).skip(skip).limit(limit).populate("broker_id").lean();


  const total = await Account.countDocuments(filter);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

export const getAccountById = async (userId, id, isAdmin = false) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    $or: [...(isObjectId ? [{ _id: id }] : []), { account_id: id }],
  };
  if (!isAdmin) {
    query.user_id = userId;
  }
  return await Account.findOne(query).populate("broker_id");
};

export const updateAccount = async (userId, id, updateData, isAdmin = false) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    $or: [...(isObjectId ? [{ _id: id }] : []), { account_id: id }],
  };
  if (!isAdmin) {
    query.user_id = userId;
  }

  const allowedFields = isAdmin ? ADMIN_UPDATABLE_FIELDS : USER_UPDATABLE_FIELDS;
  const sanitizedUpdate = pickAllowedFields(updateData, allowedFields);

  if (Object.keys(sanitizedUpdate).length === 0) {
    throw new Error("No valid fields provided for update");
  }

  if (sanitizedUpdate.broker_id) {
    const account = await Account.findOne(query);
    if (!account) {
      throw new Error("Account not found");
    }
    const targetAccountType = sanitizedUpdate.account_type || account.account_type;
    const Broker = mongoose.model("Broker");
    const broker = await Broker.findById(sanitizedUpdate.broker_id);
    if (!broker) {
      throw new Error("Associated broker not found");
    }
    if (targetAccountType !== "LIVE" && !broker.is_internal) {
      throw new Error("Only LIVE accounts can be associated with external brokers. PAPER and SIMULATION accounts must use Cobra Trades broker.");
    }
  }

  return await Account.findOneAndUpdate(query, sanitizedUpdate, {
    new: true,
    runValidators: true,
  }).populate("broker_id");
};

export const deleteAccount = async (userId, id, isAdmin = false) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    $or: [...(isObjectId ? [{ _id: id }] : []), { account_id: id }],
  };
  if (!isAdmin) {
    query.user_id = userId;
  }
  const account = await Account.findOne(query);
  if (!account) return null;

  const Deployment = mongoose.model("Deployment");
  const Position = mongoose.model("Position");
  const Trade = mongoose.model("Trade");
  const Ledger = mongoose.model("Ledger");

  // Step 1: Find all deployments linked to this account (scoped to user for non-admin)
  const deploymentQuery = { account_id: account._id };
  if (!isAdmin) deploymentQuery.user_id = userId;
  const deployments = await Deployment.find(deploymentQuery, { _id: 1 });
  const deploymentIds = deployments.map(d => d._id);

  // Step 2: Cascade-delete all child records by deployment_id first
  if (deploymentIds.length > 0) {
    await Trade.deleteMany({ deployment_id: { $in: deploymentIds } });
    await Position.deleteMany({ deployment_id: { $in: deploymentIds } });
    await Ledger.deleteMany({ deployment_id: { $in: deploymentIds } });
  }

  // Step 3: Delete any orphaned records that reference the account directly (no deployment)
  const orphanQuery = { account_id: account._id };
  if (!isAdmin) orphanQuery.user_id = userId;
  await Trade.deleteMany(orphanQuery);
  await Position.deleteMany(orphanQuery);
  await Ledger.deleteMany(orphanQuery);

  // Step 4: Delete all deployments for this account
  await Deployment.deleteMany(deploymentQuery);

  // Step 5: Delete the account itself
  await Account.deleteOne({ _id: account._id });

  console.log(`[Account Service] Cascading delete complete for account ${account.account_name}: removed ${deploymentIds.length} deployments and all associated trades/positions/ledgers.`);

  // Step 6: Explicitly clean account balance and deployment keys from Redis
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    let client;
    try {
      client = createClient({ url: redisUrl });
      await client.connect();

      const accKeys = [
        `account_balance:${account._id.toString()}`,
        `liquidity_sweep:open:${account._id.toString()}`,
      ];
      if (account.account_id) {
        accKeys.push(`account_balance:${account.account_id}`);
        accKeys.push(`liquidity_sweep:open:${account.account_id}`);
      }
      for (const k of accKeys) {
        await client.del(k).catch(() => {});
      }

      for (const depId of deploymentIds) {
        const depIdStr = depId.toString();
        let cursor = 0;
        const pattern = `*${depIdStr}*`;
        do {
          const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
          cursor = reply.cursor;
          const keys = reply.keys || [];
          if (keys.length > 0) {
            await client.del(keys);
          }
        } while (cursor !== 0);
      }
    } catch (err) {
      console.error("[Account Service] Failed to clean Redis keys on account deletion:", err.message);
    } finally {
      if (client) {
        await client.disconnect().catch(() => {});
      }
    }
  }

  try {
    const { syncAllDeploymentsToRedis } = await import("./deployment.js");
    await syncAllDeploymentsToRedis();
  } catch (err) {
    console.error("Failed to sync deployments to Redis after account deletion:", err.message);
  }

  return account;
};
