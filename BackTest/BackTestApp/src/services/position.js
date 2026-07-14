import mongoose from "mongoose";
import Position from "../models/position.js";
import { parseQueryParams } from "../utils/queryHelper.js";

export const getAllPositions = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "opened_at",
    dateField: "opened_at",
    searchFields: ["symbol", "position_id"],
  });

  // Allow larger page size for analysis views
  const effectiveLimit = Math.min(
    Math.max(1, parseInt(queryParams.limit) || limit || 50),
    500
  );
  const effectiveSkip =
    queryParams.limit != null
      ? (Math.max(1, parseInt(queryParams.page) || 1) - 1) * effectiveLimit
      : skip;

  filter.user_id = userId;

  const ensureArray = (val) => {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  };

  if (queryParams.status) {
    const statuses = ensureArray(queryParams.status).map((s) => s.toUpperCase());
    filter.status = { $in: statuses };
  }

  if (queryParams.symbol) {
    const symbols = ensureArray(queryParams.symbol).map((s) => s.toUpperCase());
    filter.symbol = { $in: symbols };
  }

  if (queryParams.direction) {
    const dirs = ensureArray(queryParams.direction).map((d) => d.toUpperCase());
    filter.direction = { $in: dirs };
  }

  if (queryParams.strategy_mode) {
    const modes = ensureArray(queryParams.strategy_mode).map((m) => m.toUpperCase());
    filter.strategy_mode = { $in: modes };
  }

  if (queryParams.deployment_id) {
    const deploymentIds = ensureArray(queryParams.deployment_id);
    filter.deployment_id = { $in: deploymentIds };
  }

  const populateTrades = String(queryParams.populate_trades || "true") !== "false";

  let query = Position.find(filter).sort(sort).skip(effectiveSkip).limit(effectiveLimit);
  if (populateTrades) {
    query = query.populate({
      path: "trades",
      options: { sort: { created_at: 1 } },
    });
  }

  const items = await query;
  const total = await Position.countDocuments(filter);

  return {
    items,
    pagination: {
      total,
      page: Math.max(1, parseInt(queryParams.page) || page || 1),
      limit: effectiveLimit,
      pages: Math.ceil(total / effectiveLimit),
    },
  };
};

export const getPositionById = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [...(isObjectId ? [{ _id: id }] : []), { position_id: id }],
  };
  return await Position.findOne(query).populate({
    path: "trades",
    options: { sort: { created_at: 1 } },
  });
};
