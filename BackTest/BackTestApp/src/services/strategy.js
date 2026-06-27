import Strategy from "../models/strategy.js";

export const createStrategy = async (userId, strategyData) => {
  const strategy = new Strategy({ ...strategyData, user_id: userId });
  return await strategy.save();
};

export const getAllStrategies = async (userId, filters = {}) => {
  const query = { user_id: userId, ...filters };

  if (typeof query.is_active === "string") {
    query.is_active = query.is_active === "true";
  }

  return await Strategy.find(query).sort({ created_at: -1 });
};

export const getStrategyById = async (userId, id) => {
  return await Strategy.findOne({ _id: id, user_id: userId });
};

export const updateStrategy = async (userId, id, updateData) => {
  return await Strategy.findOneAndUpdate(
    { _id: id, user_id: userId },
    updateData,
    {
      new: true,
      runValidators: true,
    }
  );
};

export const deleteStrategy = async (userId, id) => {
  return await Strategy.findOneAndDelete({ _id: id, user_id: userId });
};
