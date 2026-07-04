import mongoose from "mongoose";
import Trade from "../models/trade.js";
import Account from "../models/account.js";
import Ledger from "../models/ledger.js";
import Deployment from "../models/deployment.js";
import { parseQueryParams } from "../utils/queryHelper.js";

function buildAccountQuery(accountId) {
  if (mongoose.isValidObjectId(accountId)) {
    return {
      $or: [{ _id: accountId }, { account_id: String(accountId) }],
    };
  }
  return { account_id: accountId };
}

export const createTrade = async (tradeData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { price, quantity, type_of_order, user_id } = tradeData;

    if (!user_id) {
      throw new Error("user_id is required");
    }

    if (tradeData.deployment_id) {
      const deployment = await Deployment.findById(tradeData.deployment_id).session(session);
      if (!deployment) {
        throw new Error("Associated deployment not found");
      }
      tradeData.strategy_id = deployment.strategy_id;
      tradeData.user_symbol_id = deployment.user_symbol_id;
      tradeData.instrument_token = deployment.instrument_token;
      tradeData.symbol = deployment.symbol;
      if (!tradeData.account_id) {
        tradeData.account_id = deployment.account_id;
      }
    }

    const account_id = tradeData.account_id;
    if (!account_id) {
      throw new Error("account_id is required");
    }

    let account = await Account.findOne(buildAccountQuery(account_id)).session(session);
    if (!account) {
      account = new Account({
        account_id,
        account_name: tradeData.account_name || `Auto Account ${account_id}`,
        account_type: tradeData.account_type || "SIMULATION",
        initial_balance: 40000,
        current_balance: 40000,
        user_id,
      });
      await account.save({ session });
    } else if (String(account.user_id) !== String(user_id)) {
      throw new Error("Account does not belong to the authenticated user");
    }

    const tradeValue = price * quantity;

    // Calculate broker commission
    let commission = 0;
    if (account.commission_type === "PERCENTAGE") {
      const rate = account.commission_rate || 0;
      commission = parseFloat((tradeValue * (rate / 100)).toFixed(2));
    } else if (account.commission_type === "FLAT") {
      commission = account.commission_rate || 0;
    }

    const opening_balance = account.current_balance;

    if (type_of_order === "BUY" && opening_balance < (tradeValue + commission)) {
      throw new Error("Insufficient balance for BUY order (including commission)");
    }

    const change_in_balance = type_of_order === "BUY" ? -(tradeValue + commission) : (tradeValue - commission);
    const closing_balance = opening_balance + change_in_balance;

    let pnl = 0;
    if (type_of_order === "SELL") {
      const buyQuery = {
        symbol: tradeData.symbol,
        type_of_order: "BUY",
      };
      if (tradeData.deployment_id) {
        buyQuery.deployment_id = tradeData.deployment_id;
      } else {
        buyQuery.account_id = account._id;
      }
      const lastBuyTrade = await Trade.findOne(buyQuery)
        .sort({ created_at: -1 })
        .session(session);

      if (lastBuyTrade) {
        const buyCost = lastBuyTrade.price * quantity + (lastBuyTrade.commission || 0);
        const sellRevenue = price * quantity - commission;
        pnl = parseFloat((sellRevenue - buyCost).toFixed(2));
      }
    }

    const tradePayload = {
      ...tradeData,
      account_id: account._id,
      user_id,
      pnl,
      commission,
    };
    const [trade] = await Trade.create([tradePayload], { session });

    await Ledger.create(
      [
        {
          account_id: account._id,
          trade_id: trade._id,
          user_id,
          deployment_id: tradeData.deployment_id,
          strategy_id: tradeData.strategy_id,
          user_symbol_id: tradeData.user_symbol_id,
          change_in_balance,
          opening_balance,
          closing_balance,
          symbol: tradeData.symbol,
          order_type: type_of_order,
          quantity,
          price,
        },
      ],
      { session }
    );

    account.current_balance = closing_balance;
    await account.save({ session });

    await session.commitTransaction();
    session.endSession();

    return { trade, account, closing_balance };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const getAllTrades = async (userId, queryParams) => {
  const { filter, skip, limit, sort, page } = parseQueryParams(queryParams, {
    defaultSort: "created_at",
    dateField: "created_at",
    searchFields: ["symbol", "instrument_key"],
  });

  filter.user_id = userId;

  if (queryParams.type_of_order) {
    filter.type_of_order = queryParams.type_of_order.toUpperCase();
  }
  if (queryParams.symbol) {
    filter.symbol = new RegExp(queryParams.symbol, "i");
  }
  if (queryParams.account_id) {
    filter.account_id = queryParams.account_id;
  }
  if (queryParams.deployment_id) {
    filter.deployment_id = queryParams.deployment_id;
  }

  const items = await Trade.find(filter).sort(sort).skip(skip).limit(limit);

  const total = await Trade.countDocuments(filter);

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

export const getTradeById = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [...(isObjectId ? [{ _id: id }] : []), { trade_id: id }],
  };
  return await Trade.findOne(query);
};

export const deleteTrade = async (userId, id) => {
  const isObjectId = mongoose.isValidObjectId(id);
  const query = {
    user_id: userId,
    $or: [...(isObjectId ? [{ _id: id }] : []), { trade_id: id }],
  };
  return await Trade.findOneAndDelete(query);
};
