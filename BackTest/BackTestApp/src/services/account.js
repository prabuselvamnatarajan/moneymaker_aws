import mongoose from "mongoose";
import Account from "../models/account.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";

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

  const items = await Account.find(filter).sort(sort).skip(skip).limit(limit).populate("broker_id");

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

  // Cascade delete all associated entities: deployments, positions, trades, ledgers
  await Deployment.deleteMany({ account_id: account._id, user_id: userId });
  await Position.deleteMany({ account_id: account._id, user_id: userId });
  await Trade.deleteMany({ account_id: account._id, user_id: userId });
  await Ledger.deleteMany({ account_id: account._id, user_id: userId });

  await Account.deleteOne({ _id: account._id });

  try {
    const { syncAllDeploymentsToRedis } = await import("./deployment.js");
    await syncAllDeploymentsToRedis();
  } catch (err) {
    console.error("Failed to sync deployments to Redis after account deletion:", err.message);
  }

  return account;
};
