import mongoose from "mongoose";
import Account from "../models/account.js";
import { parseQueryParams } from "../utils/queryHelper.js";
import { pickAllowedFields } from "../utils/updateHelper.js";

const USER_UPDATABLE_FIELDS = ["account_name", "description", "is_active", "commission_type", "commission_rate"];
const ADMIN_UPDATABLE_FIELDS = [
  ...USER_UPDATABLE_FIELDS,
  "account_type",
  "current_balance",
  "initial_balance",
];

export const createAccount = async (userId, accountData) => {
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

  const items = await Account.find(filter).sort(sort).skip(skip).limit(limit);

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
  return await Account.findOne(query);
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

  return await Account.findOneAndUpdate(query, sanitizedUpdate, {
    new: true,
    runValidators: true,
  });
};

export const deleteAccount = async (userId, id, isAdmin = false) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    $or: [...(isObjectId ? [{ _id: id }] : []), { account_id: id }],
  };
  if (!isAdmin) {
    query.user_id = userId;
  }
  return await Account.findOneAndDelete(query);
};
