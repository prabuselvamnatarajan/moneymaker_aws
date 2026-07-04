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

  if (queryParams.strategyId) {
    filter.strategy_id = queryParams.strategyId;
  }

  if (queryParams.deploymentId) {
    filter.deployment_id = queryParams.deploymentId;
  }

  if (queryParams.symbol) {
    filter.symbol = queryParams.symbol.toUpperCase();
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

export const depositBalance = async (userId, accountId, amount, description) => {
  if (!amount || amount <= 0) throw new Error("Amount must be greater than zero");
  const Account = mongoose.model("Account");
  const account = await Account.findOne({
    user_id: userId,
    $or: [
      ...(mongoose.isValidObjectId(accountId) ? [{ _id: accountId }] : []),
      { account_id: accountId }
    ]
  });
  if (!account) throw new Error("Account not found");

  const opening = account.current_balance;
  account.current_balance += amount;
  await account.save();

  const Deployment = mongoose.model("Deployment");
  const manualDeployment = await Deployment.findOne({
    user_id: userId,
    account_id: account._id,
    deployment_name: "Manual"
  });

  const ledgerEntry = new Ledger({
    account_id: account._id,
    user_id: userId,
    change_in_balance: amount,
    opening_balance: opening,
    closing_balance: account.current_balance,
    transaction_type: "DEPOSIT",
    description: description || "Deposit transaction",
    ...(manualDeployment ? {
      deployment_id: manualDeployment._id,
      strategy_id: manualDeployment.strategy_id,
      user_symbol_id: manualDeployment.user_symbol_id,
      symbol: manualDeployment.symbol
    } : {})
  });
  return await ledgerEntry.save();
};

export const withdrawBalance = async (userId, accountId, amount, description) => {
  if (!amount || amount <= 0) throw new Error("Amount must be greater than zero");
  const Account = mongoose.model("Account");
  const account = await Account.findOne({
    user_id: userId,
    $or: [
      ...(mongoose.isValidObjectId(accountId) ? [{ _id: accountId }] : []),
      { account_id: accountId }
    ]
  });
  if (!account) throw new Error("Account not found");
  if (account.current_balance < amount) throw new Error("Insufficient funds");

  const opening = account.current_balance;
  account.current_balance -= amount;
  await account.save();

  const Deployment = mongoose.model("Deployment");
  const manualDeployment = await Deployment.findOne({
    user_id: userId,
    account_id: account._id,
    deployment_name: "Manual"
  });

  const ledgerEntry = new Ledger({
    account_id: account._id,
    user_id: userId,
    change_in_balance: -amount,
    opening_balance: opening,
    closing_balance: account.current_balance,
    transaction_type: "WITHDRAW",
    description: description || "Withdrawal transaction",
    ...(manualDeployment ? {
      deployment_id: manualDeployment._id,
      strategy_id: manualDeployment.strategy_id,
      user_symbol_id: manualDeployment.user_symbol_id,
      symbol: manualDeployment.symbol
    } : {})
  });
  return await ledgerEntry.save();
};

export const transferBalance = async (userId, fromAccountId, toAccountId, amount, description) => {
  if (!amount || amount <= 0) throw new Error("Amount must be greater than zero");
  if (fromAccountId === toAccountId) throw new Error("Source and destination accounts must be different");

  const Account = mongoose.model("Account");

  const fromAccount = await Account.findOne({
    user_id: userId,
    $or: [
      ...(mongoose.isValidObjectId(fromAccountId) ? [{ _id: fromAccountId }] : []),
      { account_id: fromAccountId }
    ]
  });
  if (!fromAccount) throw new Error("Source account not found");
  if (fromAccount.current_balance < amount) throw new Error("Insufficient funds");

  const toAccount = await Account.findOne({
    user_id: userId,
    $or: [
      ...(mongoose.isValidObjectId(toAccountId) ? [{ _id: toAccountId }] : []),
      { account_id: toAccountId }
    ]
  });
  if (!toAccount) throw new Error("Destination account not found");

  // Apply debit to fromAccount
  const fromOpening = fromAccount.current_balance;
  fromAccount.current_balance -= amount;
  await fromAccount.save();

  const Deployment = mongoose.model("Deployment");
  const fromManualDeployment = await Deployment.findOne({
    user_id: userId,
    account_id: fromAccount._id,
    deployment_name: "Manual"
  });

  const fromLedger = new Ledger({
    account_id: fromAccount._id,
    user_id: userId,
    change_in_balance: -amount,
    opening_balance: fromOpening,
    closing_balance: fromAccount.current_balance,
    transaction_type: "TRANSFER_OUT",
    description: description || `Transfer to account: ${toAccount.account_name}`,
    ...(fromManualDeployment ? {
      deployment_id: fromManualDeployment._id,
      strategy_id: fromManualDeployment.strategy_id,
      user_symbol_id: fromManualDeployment.user_symbol_id,
      symbol: fromManualDeployment.symbol
    } : {})
  });
  await fromLedger.save();

  // Apply credit to toAccount
  const toOpening = toAccount.current_balance;
  toAccount.current_balance += amount;
  await toAccount.save();

  const toManualDeployment = await Deployment.findOne({
    user_id: userId,
    account_id: toAccount._id,
    deployment_name: "Manual"
  });

  const toLedger = new Ledger({
    account_id: toAccount._id,
    user_id: userId,
    change_in_balance: amount,
    opening_balance: toOpening,
    closing_balance: toAccount.current_balance,
    transaction_type: "TRANSFER_IN",
    description: description || `Transfer from account: ${fromAccount.account_name}`,
    ...(toManualDeployment ? {
      deployment_id: toManualDeployment._id,
      strategy_id: toManualDeployment.strategy_id,
      user_symbol_id: toManualDeployment.user_symbol_id,
      symbol: toManualDeployment.symbol
    } : {})
  });
  await toLedger.save();

  return { fromLedger, toLedger };
};
