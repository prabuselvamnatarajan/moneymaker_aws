import Strategy from "../models/strategy.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";

const USER_UPDATABLE_FIELDS = ["strategy_name", "strategy_description", "is_active", "target_pts", "sl_pts", "advance_trade_decision"];
const ADMIN_UPDATABLE_FIELDS = [...USER_UPDATABLE_FIELDS];

export const createStrategy = async (userId, strategyData) => {
  const data = { ...strategyData };
  if (!data.advance_trade_decision) {
    data.target_pts = 500;
    data.sl_pts = 500;
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
  return await Strategy.findOneAndDelete(query);
};
