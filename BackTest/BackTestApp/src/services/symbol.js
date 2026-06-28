import mongoose from "mongoose";
import UserSymbol from "../models/userSymbol.js";
import { parseQueryParams } from "../utils/queryHelper.js";

export const createSymbol = async (userId, symbolData) => {
  const symbol = new UserSymbol({ ...symbolData, user_id: userId });
  return await symbol.save();
};

export const getAllSymbols = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "added_at",
    dateField: "added_at",
    searchFields: ["symbol", "exchange"]
  });

  filter.user_id = userId;

  const items = await UserSymbol.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit);

  const total = await UserSymbol.countDocuments(filter);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
};

export const getSymbolById = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [
      ...(isObjectId ? [{ _id: id }] : []),
      { user_symbol_id: id }
    ]
  };
  return await UserSymbol.findOne(query);
};

export const updateSymbol = async (userId, id, updateData) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [
      ...(isObjectId ? [{ _id: id }] : []),
      { user_symbol_id: id }
    ]
  };
  return await UserSymbol.findOneAndUpdate(query, updateData, {
    new: true,
    runValidators: true
  });
};

export const deleteSymbol = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [
      ...(isObjectId ? [{ _id: id }] : []),
      { user_symbol_id: id }
    ]
  };
  return await UserSymbol.findOneAndDelete(query);
};
