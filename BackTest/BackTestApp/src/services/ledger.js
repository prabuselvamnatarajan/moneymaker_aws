import mongoose from "mongoose";
import Ledger from "../models/ledger.js";
import { parseQueryParams } from "../utils/queryHelper.js";

export const getAllLedger = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "created_on",
    dateField: "created_on",
    searchFields: ["symbol"],
  });

  filter.user_id = userId;

  if (queryParams.accountId) {
    const Account = mongoose.model("Account");
    const account = await Account.findOne({
      user_id: userId,
      $or: [
        ...(mongoose.isValidObjectId(queryParams.accountId)
          ? [{ _id: queryParams.accountId }]
          : []),
        { account_id: queryParams.accountId },
      ],
    });
    if (account) {
      filter.account_id = account._id;
    } else {
      return {
        items: [],
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0,
        },
      };
    }
  }

  if (queryParams.type === "credit") {
    filter.change_in_balance = { $gt: 0 };
  } else if (queryParams.type === "debit") {
    filter.change_in_balance = { $lt: 0 };
  }

  const items = await Ledger.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate("account_id")
    .populate("trade_id");

  const total = await Ledger.countDocuments(filter);

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

export const getLedgerById = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [...(isObjectId ? [{ _id: id }] : []), { ledger_id: id }],
  };
  return await Ledger.findOne(query).populate("account_id").populate("trade_id");
};
