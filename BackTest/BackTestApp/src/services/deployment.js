import Deployment from "../models/deployment.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";

const USER_UPDATABLE_FIELDS = ["deployment_name", "notes"];

export const createDeployment = async (userId, deploymentData) => {
  const deployment = new Deployment({ ...deploymentData, user_id: userId });
  return await deployment.save();
};

export const getAllDeployments = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "start_time",
    dateField: "start_time",
    searchFields: ["symbol", "deployment_name"],
  });

  filter.user_id = userId;

  if (queryParams.current_status) {
    filter.current_status = queryParams.current_status.toUpperCase();
  }

  const items = await Deployment.find(filter).sort(sort).skip(skip).limit(limit);

  const total = await Deployment.countDocuments(filter);

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

export const getDeploymentById = async (userId, id) => {
  return await Deployment.findOne({ _id: id, user_id: userId });
};

export const updateDeployment = async (userId, id, updateData) => {
  const sanitizedUpdate = pickAllowedFields(updateData, USER_UPDATABLE_FIELDS);

  if (Object.keys(sanitizedUpdate).length === 0) {
    throw new Error("No valid fields provided for update");
  }

  return await Deployment.findOneAndUpdate(
    { _id: id, user_id: userId },
    sanitizedUpdate,
    {
      new: true,
      runValidators: true,
    }
  );
};

export const deleteDeployment = async (userId, id) => {
  return await Deployment.findOneAndDelete({ _id: id, user_id: userId });
};

// --- Lifecycle Actions ---

const VALID_TRANSITIONS = {
  start: { from: ["SCHEDULED", "STOPPED", "COMPLETED"], to: "RUNNING" },
  stop: { from: ["RUNNING", "PAUSED"], to: "STOPPED" },
  pause: { from: ["RUNNING"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "RUNNING" },
  restart: { from: ["RUNNING", "PAUSED", "STOPPED", "COMPLETED"], to: "RUNNING" },
};

export const transitionDeployment = async (userId, id, action) => {
  const transition = VALID_TRANSITIONS[action];
  if (!transition) {
    throw new Error(`Invalid action: ${action}`);
  }

  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) {
    return null;
  }

  if (!transition.from.includes(deployment.current_status)) {
    throw new Error(
      `Cannot ${action} deployment in status '${deployment.current_status}'. Allowed from: ${transition.from.join(", ")}`
    );
  }

  deployment.current_status = transition.to;

  if (action === "start" || action === "restart") {
    deployment.start_time = new Date();
  }
  if (action === "stop") {
    deployment.end_time = new Date();
  }

  await deployment.save();
  return deployment;
};

// --- Monitoring ---

export const getDeploymentStatus = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;
  return {
    _id: deployment._id,
    current_status: deployment.current_status,
    start_time: deployment.start_time,
    end_time: deployment.end_time,
    symbol: deployment.symbol,
  };
};

export const getDeploymentLogs = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;
  return deployment.logs || [];
};

export const getDeploymentMetrics = async (userId, id) => {
  const deployment = await Deployment.findOne({ _id: id, user_id: userId });
  if (!deployment) return null;

  const Trade = (await import("../models/trade.js")).default;
  const trades = await Trade.find({ deployment_id: deployment._id });

  const totalTrades = trades.length;
  let totalPnL = 0;
  let wins = 0;
  let losses = 0;

  for (const trade of trades) {
    const pnl = trade.pnl || 0;
    totalPnL += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }

  return {
    deployment_id: deployment._id,
    current_status: deployment.current_status,
    total_trades: totalTrades,
    total_pnl: totalPnL,
    wins,
    losses,
    win_rate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) + "%" : "0%",
  };
};
