import mongoose from "mongoose";
import Strategy from "../models/strategy.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";

const USER_UPDATABLE_FIELDS = ["strategy_name", "strategy_description", "is_active", "target_pts", "sl_pts", "advance_trade_decision", "target_type", "target_pct", "sl_pct"];
const ADMIN_UPDATABLE_FIELDS = [...USER_UPDATABLE_FIELDS];

export const createStrategy = async (userId, strategyData) => {
  const data = { ...strategyData };
  if (!data.advance_trade_decision) {
    data.target_pts = 500;
    data.sl_pts = 500;
    data.target_type = "POINTS";
    data.target_pct = 2;
    data.sl_pct = 2;
    data.advance_trade_decision = false;
  }
  const strategy = new Strategy({ ...data, user_id: userId });
  return await strategy.save();
};

export const getAllStrategies = async (userId, queryParams, isAdmin = false) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "created_at",
    dateField: "created_at",
    searchFields: ["strategy_name", "strategy_description"],
  });

  if (!isAdmin) {
    filter.user_id = userId;
  }

  const items = await Strategy.find(filter).sort(sort).skip(skip).limit(limit);

  const total = await Strategy.countDocuments(filter);

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

export const getStrategyById = async (userId, id, isAdmin = false) => {
  const query = { _id: id };
  if (!isAdmin) {
    query.user_id = userId;
  }
  return await Strategy.findOne(query);
};

export const updateStrategy = async (userId, id, updateData, isAdmin = false) => {
  const query = { _id: id };
  if (!isAdmin) {
    query.user_id = userId;
  }

  const allowedFields = isAdmin ? ADMIN_UPDATABLE_FIELDS : USER_UPDATABLE_FIELDS;
  const sanitizedUpdate = pickAllowedFields(updateData, allowedFields);

  if (Object.keys(sanitizedUpdate).length === 0) {
    throw new Error("No valid fields provided for update");
  }

  if (sanitizedUpdate.hasOwnProperty("advance_trade_decision") && !sanitizedUpdate.advance_trade_decision) {
    sanitizedUpdate.target_pts = 500;
    sanitizedUpdate.sl_pts = 500;
    sanitizedUpdate.target_type = "POINTS";
    sanitizedUpdate.target_pct = 2;
    sanitizedUpdate.sl_pct = 2;
  }

  return await Strategy.findOneAndUpdate(query, sanitizedUpdate, {
    new: true,
    runValidators: true,
  });
};

export const deleteStrategy = async (userId, id, isAdmin = false) => {
  const query = { _id: id };
  if (!isAdmin) {
    query.user_id = userId;
  }
  const strategy = await Strategy.findOne(query);
  if (!strategy) return null;

  const Deployment = mongoose.model("Deployment");
  const Position = mongoose.model("Position");
  const Trade = mongoose.model("Trade");
  const Ledger = mongoose.model("Ledger");

  // Step 1: Find all deployments linked to this strategy (scoped to user for non-admin)
  const deploymentQuery = { strategy_id: strategy._id };
  if (!isAdmin) deploymentQuery.user_id = userId;
  const deployments = await Deployment.find(deploymentQuery, { _id: 1 });
  const deploymentIds = deployments.map(d => d._id);

  // Step 2: Cascade-delete all child records by deployment_id first
  if (deploymentIds.length > 0) {
    await Trade.deleteMany({ deployment_id: { $in: deploymentIds } });
    await Position.deleteMany({ deployment_id: { $in: deploymentIds } });
    await Ledger.deleteMany({ deployment_id: { $in: deploymentIds } });
  }

  // Step 3: Delete any orphaned records that reference the strategy directly (no deployment)
  const orphanQuery = { strategy_id: strategy._id };
  if (!isAdmin) orphanQuery.user_id = userId;
  await Trade.deleteMany(orphanQuery);
  await Position.deleteMany(orphanQuery);
  await Ledger.deleteMany(orphanQuery);

  // Step 4: Delete all deployments for this strategy
  await Deployment.deleteMany(deploymentQuery);

  // Step 5: Delete the strategy template itself
  await Strategy.deleteOne({ _id: strategy._id });

  console.log(`[Strategy Service] Cascading delete complete for strategy ${strategy.strategy_name}: removed ${deploymentIds.length} deployments and all associated trades/positions/ledgers.`);

  try {
    const { syncAllDeploymentsToRedis } = await import("./deployment.js");
    await syncAllDeploymentsToRedis();
  } catch (err) {
    console.error("Failed to sync deployments to Redis after strategy deletion:", err.message);
  }

  return strategy;
};
