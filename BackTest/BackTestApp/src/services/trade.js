import mongoose from "mongoose";
import Trade from "../models/trade.js";
import Account from "../models/account.js";
import Ledger from "../models/ledger.js";
import Deployment from "../models/deployment.js";
import { parseQueryParams, getProjectionFields } from "../utils/queryHelper.js";

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

    let deploymentId = tradeData.deployment_id;
    if (!deploymentId || deploymentId === "none" || deploymentId === "") {
      const account_id = tradeData.account_id;
      if (account_id) {
        const accountObj = await Account.findOne(buildAccountQuery(account_id)).session(session);
        if (accountObj) {
          const manualDeployment = await Deployment.findOne({
            user_id,
            account_id: accountObj._id,
            deployment_name: "Manual",
          }).session(session);
          if (manualDeployment) {
            deploymentId = manualDeployment._id;
            tradeData.deployment_id = manualDeployment._id;
          }
        }
      }
    }

    let deployment = null;
    if (deploymentId && deploymentId !== "none" && deploymentId !== "") {
      deployment = await Deployment.findById(deploymentId).session(session);
      if (!deployment) {
        throw new Error("Associated deployment not found");
      }
      tradeData.strategy_id = deployment.strategy_id;
      tradeData.user_symbol_id = deployment.user_symbol_id;
      tradeData.instrument_token = deployment.instrument_token;
      tradeData.symbol = deployment.symbol;
      tradeData.deployment_id = deployment._id;
      if (!tradeData.account_id) {
        tradeData.account_id = deployment.account_id;
      }
    }

    if (!tradeData.user_symbol_id && tradeData.symbol) {
      const UserSymbol = mongoose.model("UserSymbol");
      const userSymbol = await UserSymbol.findOne({
        user_id,
        $or: [
          { symbol: tradeData.symbol },
          { symbol: tradeData.symbol.toUpperCase() },
        ],
      }).session(session);
      if (userSymbol) {
        tradeData.user_symbol_id = userSymbol._id;
        tradeData.instrument_token = userSymbol.instrument_token;
        tradeData.symbol = userSymbol.symbol;
      } else {
        throw new Error(`Symbol ${tradeData.symbol} not found in user's watchlisted symbols`);
      }
    }

    const account_id = tradeData.account_id;
    if (!account_id) {
      throw new Error("account_id is required");
    }

    let account = await Account.findOne(buildAccountQuery(account_id)).session(session);
    if (!account) {
      throw new Error(`Account associated with ID ${account_id} does not exist`);
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

    // Calculate P&L using chronological position-based simulation of previous trades
    let pnl = 0;
    let positionSize = 0;
    let averageEntryPrice = 0;

    if (deployment) {
      positionSize = deployment.position_size || 0;
      averageEntryPrice = deployment.average_entry_price || 0;
    } else {
      const prevTradesQuery = {
        account_id: account._id,
        symbol: tradeData.symbol,
      };

      const prevTrades = await Trade.find(prevTradesQuery)
        .sort({ created_at: 1 })
        .session(session);

      for (const t of prevTrades) {
        const qty = t.quantity || 0;
        const priceVal = t.price || 0;
        const isBuy = t.type_of_order === "BUY";
        const comm = t.commission || 0;

        if (isBuy) {
          if (positionSize >= 0) {
            const newSize = positionSize + qty;
            averageEntryPrice = newSize > 0 ? (averageEntryPrice * positionSize + priceVal * qty + comm) / newSize : 0;
            positionSize = newSize;
          } else {
            const coveredQty = Math.min(Math.abs(positionSize), qty);
            const remainingQty = qty - coveredQty;
            positionSize += coveredQty;
            if (remainingQty > 0) {
              positionSize = remainingQty;
              averageEntryPrice = priceVal;
            } else if (positionSize === 0) {
              averageEntryPrice = 0;
            }
          }
        } else {
          if (positionSize <= 0) {
            const newSize = positionSize - qty;
            const absNewSize = Math.abs(newSize);
            averageEntryPrice = absNewSize > 0 ? (averageEntryPrice * Math.abs(positionSize) + priceVal * qty + comm) / absNewSize : 0;
            positionSize = newSize;
          } else {
            const exitedQty = Math.min(positionSize, qty);
            const remainingQty = qty - exitedQty;
            positionSize -= exitedQty;
            if (remainingQty > 0) {
              positionSize = -remainingQty;
              averageEntryPrice = priceVal;
            } else if (positionSize === 0) {
              averageEntryPrice = 0;
            }
          }
        }
      }
    }

    // Now calculate P&L of the current trade
    const isBuy = type_of_order === "BUY";
    if (isBuy) {
      if (positionSize < 0) {
        // Covering short position
        const coveredQty = Math.min(Math.abs(positionSize), quantity);
        pnl = parseFloat(((averageEntryPrice - price) * coveredQty - commission).toFixed(2));
      }
    } else {
      if (positionSize > 0) {
        // Exiting long position
        const exitedQty = Math.min(positionSize, quantity);
        pnl = parseFloat(((price - averageEntryPrice) * exitedQty - commission).toFixed(2));
      }
    }

    // Now calculate the new position size and average entry price for the deployment
    let newPositionSize = positionSize;
    let newAverageEntryPrice = averageEntryPrice;

    if (isBuy) {
      if (positionSize >= 0) {
        const newSize = positionSize + quantity;
        newAverageEntryPrice = newSize > 0 ? (averageEntryPrice * positionSize + price * quantity + commission) / newSize : 0;
        newPositionSize = newSize;
      } else {
        const coveredQty = Math.min(Math.abs(positionSize), quantity);
        const remainingQty = quantity - coveredQty;
        newPositionSize += coveredQty;
        if (remainingQty > 0) {
          newPositionSize = remainingQty;
          newAverageEntryPrice = price;
        } else if (newPositionSize === 0) {
          newAverageEntryPrice = 0;
        }
      }
    } else {
      if (positionSize <= 0) {
        const newSize = positionSize - quantity;
        const absNewSize = Math.abs(newSize);
        newAverageEntryPrice = absNewSize > 0 ? (averageEntryPrice * Math.abs(positionSize) + price * quantity + commission) / absNewSize : 0;
        newPositionSize = newSize;
      } else {
        const exitedQty = Math.min(positionSize, quantity);
        const remainingQty = quantity - exitedQty;
        newPositionSize -= exitedQty;
        if (remainingQty > 0) {
          newPositionSize = -remainingQty;
          newAverageEntryPrice = price;
        } else if (newPositionSize === 0) {
          newAverageEntryPrice = 0;
        }
      }
    }

    if (deployment) {
      deployment.position_size = newPositionSize;
      deployment.average_entry_price = newAverageEntryPrice;
      await deployment.save({ session });
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

  const ensureArray = (val) => {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  };

  if (queryParams.type_of_order) {
    const types = ensureArray(queryParams.type_of_order).map(t => t.toUpperCase());
    filter.type_of_order = { $in: types };
  }

  if (queryParams.status) {
    const statuses = ensureArray(queryParams.status).map(s => s.toUpperCase());
    filter.status = { $in: statuses };
  }

  if (queryParams.symbol) {
    const symbols = ensureArray(queryParams.symbol).map(s => s.toUpperCase());
    filter.symbol = { $in: symbols };
  }

  if (queryParams.account_id) {
    const accountQueryIds = ensureArray(queryParams.account_id);
    const validObjectIds = accountQueryIds.filter(id => mongoose.isValidObjectId(id));
    const accounts = await Account.find({
      user_id: userId,
      $or: [
        { _id: { $in: validObjectIds } },
        { account_id: { $in: accountQueryIds } },
      ],
    });
    if (accounts.length > 0) {
      filter.account_id = { $in: accounts.map(a => a._id) };
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

  if (queryParams.deployment_id) {
    const deploymentIds = ensureArray(queryParams.deployment_id);
    filter.deployment_id = { $in: deploymentIds };
  }

  const projection = queryParams.fields ? getProjectionFields(queryParams.fields) : undefined;
  const items = await Trade.find(filter, projection).sort(sort).skip(skip).limit(limit);

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
