import SweepSignalLog from "../models/sweepSignalLog.js";
import Deployment from "../models/deployment.js";

export const createSweepSignalLog = async (deploymentId, payload) => {
  const deployment = await Deployment.findById(deploymentId).populate("strategy_id");
  if (!deployment) {
    throw new Error("Deployment not found");
  }

  const doc = await SweepSignalLog.create({
    deployment_id: deployment._id,
    user_id: deployment.user_id,
    symbol: payload.symbol || deployment.symbol,
    eventType: payload.eventType || "sweep",
    outcome: payload.outcome,
    level: payload.level,
    levelType: payload.levelType,
    direction: payload.direction,
    sweepExtreme: payload.sweepExtreme,
    ltp: payload.ltp,
    tickCount: payload.tickCount,
    eventType_detail: payload.eventType === "trade" ? payload : undefined,
    params_snapshot: payload.params_snapshot,
    timestamp: payload.timestamp || payload.loggedAt || Date.now(),
  });

  return doc;
};

export const getSweepSignalLogs = async (userId, deploymentId, query = {}) => {
  const deployment = await Deployment.findOne({ _id: deploymentId, user_id: userId });
  if (!deployment) {
    return null;
  }

  const { outcome, page = 1, limit = 50 } = query;
  const filter = { deployment_id: deploymentId };
  if (outcome) {
    filter.outcome = outcome;
  }

  const skip = (Math.max(Number(page), 1) - 1) * Math.min(Number(limit), 200);
  const take = Math.min(Number(limit), 200);

  const [items, total] = await Promise.all([
    SweepSignalLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(take),
    SweepSignalLog.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      total,
      page: Number(page),
      limit: take,
      pages: Math.ceil(total / take) || 1,
    },
  };
};

export const getSweepSignalStats = async (userId, deploymentId) => {
  const deployment = await Deployment.findOne({ _id: deploymentId, user_id: userId });
  if (!deployment) {
    return null;
  }

  const pipeline = [
    { $match: { deployment_id: deployment._id, eventType: "sweep" } },
    {
      $group: {
        _id: "$outcome",
        count: { $sum: 1 },
      },
    },
  ];

  const byOutcome = await SweepSignalLog.aggregate(pipeline);

  const levelPipeline = [
    { $match: { deployment_id: deployment._id, eventType: "sweep" } },
    {
      $group: {
        _id: "$levelType",
        count: { $sum: 1 },
      },
    },
  ];

  const byLevelType = await SweepSignalLog.aggregate(levelPipeline);
  const total = byOutcome.reduce((sum, row) => sum + row.count, 0);
  const confirmed = byOutcome.find((r) => r._id === "rejection_confirmed")?.count || 0;

  return {
    total,
    confirmed,
    confirmationRate: total > 0 ? confirmed / total : 0,
    byOutcome: byOutcome.map((r) => ({ outcome: r._id, count: r.count })),
    byLevelType: byLevelType.map((r) => ({ levelType: r._id || "unknown", count: r.count })),
  };
};
