import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import Trade from "../models/trade.js";
import Account from "../models/account.js";
import Ledger from "../models/ledger.js";
import Deployment from "../models/deployment.js";
import Position from "../models/position.js";
import { parseQueryParams, getProjectionFields } from "../utils/queryHelper.js";
import {
  calcUnrealizedPnl,
  calcProfitPct,
  applyExcursion,
  applyBuySellPrice,
  directionFromSignedSize,
} from "../utils/positionMath.js";
import {
  syncOpenPositionToRedis,
  removeOpenPositionFromRedis,
  readLiveCache,
} from "../utils/positionRedis.js";

async function updateBacktestExcursions(position, currentTradeTime, TradeModel) {
  let startTime = position.opened_at;
  if (position.trades && position.trades.length > 0) {
    const lastTradeId = position.trades[position.trades.length - 1];
    const lastTrade = await TradeModel.findById(lastTradeId);
    if (lastTrade) {
      startTime = lastTrade.execution_time || lastTrade.created_at || startTime;
    }
  }

  const startMs = new Date(startTime).getTime();
  const endMs = new Date(currentTradeTime).getTime();

  if (startMs >= endMs) {
    return;
  }

  // Get all date strings between startMs and endMs inclusive to handle multi-day positions
  const dates = [];
  let currentMs = startMs;
  while (currentMs <= endMs) {
    dates.push(new Date(currentMs).toISOString().slice(0, 10));
    currentMs += 24 * 60 * 60 * 1000;
  }
  const lastDateStr = new Date(endMs).toISOString().slice(0, 10);
  if (!dates.includes(lastDateStr)) {
    dates.push(lastDateStr);
  }

  const symbol = position.symbol;
  const sanitizedSymbol = String(symbol).replace(/[^a-zA-Z0-9-_]/g, '_');
  
  let ticks = [];
  const baseDataDir = process.env.EXPORTED_DATA_DIR || process.env.SHARED_DIR || path.join(process.cwd(), "..", "exportedData");
  for (const d of dates) {
    let filePath = path.join(baseDataDir, d, `${sanitizedSymbol}.json`);
    try {
      await fs.access(filePath);
    } catch (err) {
      const fallbackPath = path.join("/shared", "exportedData", d, `${sanitizedSymbol}.json`);
      try {
        await fs.access(fallbackPath);
        filePath = fallbackPath;
      } catch (fallbackErr) {
        console.warn(`[updateBacktestExcursions] Ticks file not found for ${symbol} on ${d} (checked ${filePath} and ${fallbackPath}).`);
        continue;
      }
    }

    try {
      const fileContent = await fs.readFile(filePath, "utf8");
      const dayTicks = JSON.parse(fileContent);
      if (Array.isArray(dayTicks)) {
        ticks = ticks.concat(dayTicks);
      }
    } catch (err) {
      console.error(`[updateBacktestExcursions] Error reading/parsing ticks file for ${d}: ${err.message}`);
    }
  }

  if (ticks.length === 0) return;

  let maxUp = position.max_up || 0;
  let maxDown = position.max_down || 0;
  let maxUpPct = position.max_up_pct || 0;
  let maxDownPct = position.max_down_pct || 0;

  for (const tick of ticks) {
    const feed = tick.fullFeed?.marketFF || tick.fullFeed?.indexFF;
    if (!feed?.ltpc) continue;

    const ltpc = feed.ltpc;
    const ltp = ltpc.ltp;
    if (ltp === undefined || ltp === null) continue;

    let tickTimeMs;
    if (tick.timestamp) {
      tickTimeMs = new Date(tick.timestamp).getTime();
    } else if (ltpc.ltt) {
      tickTimeMs = parseInt(ltpc.ltt, 10);
    } else {
      continue;
    }

    if (tickTimeMs < startMs || tickTimeMs > endMs) {
      continue;
    }

    const unrealised = calcUnrealizedPnl(position.average_entry_price, position.direction, position.open_size, ltp);
    const pct = calcProfitPct(position.average_entry_price, position.direction, ltp);

    maxUp = Math.max(maxUp, unrealised);
    maxDown = Math.min(maxDown, unrealised);
    maxUpPct = Math.max(maxUpPct, pct);
    maxDownPct = Math.min(maxDownPct, pct);
  }

  position.max_up = maxUp;
  position.max_down = maxDown;
  position.max_up_pct = maxUpPct;
  position.max_down_pct = maxDownPct;
}

function buildAccountQuery(accountId) {
  if (mongoose.isValidObjectId(accountId)) {
    return {
      $or: [{ _id: accountId }, { account_id: String(accountId) }],
    };
  }
  return { account_id: accountId };
}

function buildPositionBase(tradeData, account, deployment, direction, size, entryPrice, price, typeOfOrder, commission) {
  const position = {
    deployment_id: tradeData.deployment_id,
    user_id: tradeData.user_id,
    strategy_id: tradeData.strategy_id,
    account_id: account._id,
    user_symbol_id: tradeData.user_symbol_id,
    instrument_token: tradeData.instrument_token,
    symbol: String(tradeData.symbol || "").toUpperCase(),
    strategy_mode: deployment?.strategy_mode || undefined,
    direction,
    status: "OPEN",
    total_size: Math.abs(size),
    open_size: Math.abs(size),
    average_entry_price: entryPrice > 0 ? entryPrice : (price > 0 ? price : 0),
    buy_price: 0,
    sell_price: 0,
    buy_qty: 0,
    sell_qty: 0,
    realised_pnl: 0,
    unrealised_pnl: 0,
    max_up: 0,
    max_down: 0,
    max_up_pct: 0,
    max_down_pct: 0,
    commission_total: commission || 0,
    trades: [],
    opened_at: tradeData.execution_time ? new Date(tradeData.execution_time) : new Date(),
    closed_at: null,
    last_ltp: price > 0 ? price : 0,
  };
  applyBuySellPrice(position, typeOfOrder, price, Math.abs(size));
  return position;
}

async function finalizeClosePosition(position, trade, price, pnlContribution, session, liveCache) {
  const entry = position.average_entry_price || 0;
  const openBeforeClose = position.open_size || 0;
  const direction = position.direction;

  // Fold closing price into excursions using size before zeroing
  if (position.strategy_mode === "BACKTEST") {
    await updateBacktestExcursions(position, trade.execution_time || trade.created_at || new Date(), Trade);
  } else if (price > 0 && openBeforeClose > 0 && entry > 0) {
    const unrealised = calcUnrealizedPnl(entry, direction, openBeforeClose, price);
    const pct = calcProfitPct(entry, direction, price);
    const extremum = applyExcursion(
      {
        max_up: liveCache?.maxUp ?? position.max_up,
        max_down: liveCache?.maxDown ?? position.max_down,
        max_up_pct: liveCache?.maxUpPct ?? position.max_up_pct,
        max_down_pct: liveCache?.maxDownPct ?? position.max_down_pct,
      },
      unrealised,
      pct
    );
    position.max_up = extremum.max_up;
    position.max_down = extremum.max_down;
    position.max_up_pct = extremum.max_up_pct;
    position.max_down_pct = extremum.max_down_pct;
  } else if (liveCache) {
    position.max_up = Math.max(position.max_up || 0, liveCache.maxUp || 0);
    position.max_down = Math.min(position.max_down || 0, liveCache.maxDown || 0);
    position.max_up_pct = Math.max(position.max_up_pct || 0, liveCache.maxUpPct || 0);
    position.max_down_pct = Math.min(position.max_down_pct || 0, liveCache.maxDownPct || 0);
  }

  // Attribute only the closed quantity to buy/sell averages (handles flips)
  const closedQty = Math.min(trade.quantity || 0, openBeforeClose || trade.quantity || 0);
  applyBuySellPrice(position, trade.type_of_order, price, closedQty > 0 ? closedQty : trade.quantity);
  position.realised_pnl = parseFloat(((position.realised_pnl || 0) + (pnlContribution || 0)).toFixed(2));
  position.commission_total = parseFloat(((position.commission_total || 0) + (trade.commission || 0)).toFixed(2));
  position.open_size = 0;
  position.unrealised_pnl = 0;
  position.status = "CLOSED";
  position.closed_at = trade.execution_time ? new Date(trade.execution_time) : new Date();
  position.last_ltp = price > 0 ? price : position.last_ltp;
  if (!position.trades.some((id) => String(id) === String(trade._id))) {
    position.trades.push(trade._id);
  }
  await position.save({ session });
  return position;
}

export const createTrade = async (tradeData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  /** Redis sync payloads applied only after successful Mongo commit */
  const redisOps = [];

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
      if (String(deployment.user_id) !== String(user_id)) {
        throw new Error("Associated deployment does not belong to the authenticated user");
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

    if (tradeData.user_symbol_id) {
      const UserSymbol = mongoose.model("UserSymbol");
      const userSymbol = await UserSymbol.findById(tradeData.user_symbol_id).session(session);
      if (userSymbol && !userSymbol.is_active) {
        throw new Error(`Cannot place order: Symbol ${userSymbol.symbol || tradeData.symbol} is inactive`);
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

    // ---- Position entity lifecycle ----
    let linkedPositionId = null;
    let openPositionDoc = null;
    if (tradeData.deployment_id) {
      openPositionDoc = await Position.findOne({
        deployment_id: tradeData.deployment_id,
        status: "OPEN",
      }).session(session);
    }

    const crossesZero =
      positionSize !== 0 &&
      newPositionSize !== 0 &&
      Math.sign(positionSize) !== Math.sign(newPositionSize);

    const isOpen = positionSize === 0 && newPositionSize !== 0;
    const isFullClose = positionSize !== 0 && newPositionSize === 0;
    const isScaleIn =
      positionSize !== 0 &&
      newPositionSize !== 0 &&
      Math.sign(positionSize) === Math.sign(newPositionSize) &&
      Math.abs(newPositionSize) > Math.abs(positionSize);
    const isPartialClose =
      positionSize !== 0 &&
      newPositionSize !== 0 &&
      Math.sign(positionSize) === Math.sign(newPositionSize) &&
      Math.abs(newPositionSize) < Math.abs(positionSize);

    // Create trade first (without position_id), then update with linked position
    const tradePayload = {
      ...tradeData,
      account_id: account._id,
      user_id,
      pnl,
      commission,
      position_id: null,
    };
    if (tradeData.execution_time) {
      tradePayload.execution_time = new Date(tradeData.execution_time);
      tradePayload.created_at = new Date(tradeData.execution_time);
    }
    const [trade] = await Trade.create([tradePayload], { session });

    if (isOpen) {
      const direction = directionFromSignedSize(newPositionSize);
      const entryPrice = newAverageEntryPrice > 0 ? newAverageEntryPrice : price;
      const [created] = await Position.create(
        [
          buildPositionBase(
            tradeData,
            account,
            deployment,
            direction,
            newPositionSize,
            entryPrice,
            price,
            type_of_order,
            commission
          ),
        ],
        { session }
      );
      created.trades.push(trade._id);
      await created.save({ session });
      linkedPositionId = created._id;
      redisOps.push({ type: "sync", position: created.toObject() });
    } else if (isFullClose && openPositionDoc) {
      const liveCache = await readLiveCache(openPositionDoc._id.toString());
      await finalizeClosePosition(openPositionDoc, trade, price, pnl, session, liveCache);
      linkedPositionId = openPositionDoc._id;
      redisOps.push({ type: "remove", position: openPositionDoc.toObject() });
    } else if (crossesZero) {
      // Close existing, then open remainder as a new position
      if (openPositionDoc) {
        const liveCache = await readLiveCache(openPositionDoc._id.toString());
        await finalizeClosePosition(openPositionDoc, trade, price, pnl, session, liveCache);
        redisOps.push({ type: "remove", position: openPositionDoc.toObject() });
        linkedPositionId = openPositionDoc._id;
      }

      const direction = directionFromSignedSize(newPositionSize);
      const entryPrice = newAverageEntryPrice > 0 ? newAverageEntryPrice : price;
      const remainderSize = Math.abs(newPositionSize);
      const [created] = await Position.create(
        [
          {
            ...buildPositionBase(
              tradeData,
              account,
              deployment,
              direction,
              remainderSize,
              entryPrice,
              price,
              type_of_order,
              0 // commission already attributed to closed leg
            ),
            commission_total: 0,
          },
        ],
        { session }
      );
      // Link this trade to the new position as well (flip fills both)
      created.trades.push(trade._id);
      // For flip, buy/sell qty on the new position should reflect only remainder
      created.buy_qty = 0;
      created.sell_qty = 0;
      created.buy_price = 0;
      created.sell_price = 0;
      applyBuySellPrice(created, type_of_order, price, remainderSize);
      await created.save({ session });
      linkedPositionId = linkedPositionId || created._id;
      redisOps.push({ type: "sync", position: created.toObject() });
    } else if ((isScaleIn || isPartialClose) && openPositionDoc) {
      if (openPositionDoc.strategy_mode === "BACKTEST") {
        await updateBacktestExcursions(openPositionDoc, trade.execution_time || trade.created_at || new Date(), Trade);
      }
      applyBuySellPrice(openPositionDoc, type_of_order, price, quantity);
      openPositionDoc.open_size = Math.abs(newPositionSize);
      openPositionDoc.average_entry_price =
        newAverageEntryPrice > 0 ? newAverageEntryPrice : openPositionDoc.average_entry_price;
      openPositionDoc.commission_total = parseFloat(
        ((openPositionDoc.commission_total || 0) + commission).toFixed(2)
      );
      if (isScaleIn) {
        openPositionDoc.total_size = (openPositionDoc.total_size || 0) + quantity;
      }
      if (isPartialClose) {
        openPositionDoc.realised_pnl = parseFloat(
          ((openPositionDoc.realised_pnl || 0) + pnl).toFixed(2)
        );
      }
      if (openPositionDoc.strategy_mode === "BACKTEST") {
        openPositionDoc.last_ltp = price;
        openPositionDoc.unrealised_pnl = calcUnrealizedPnl(
          openPositionDoc.average_entry_price,
          openPositionDoc.direction,
          openPositionDoc.open_size,
          price
        );
      } else if (price > 0) {
        openPositionDoc.last_ltp = price;
        const unrealised = calcUnrealizedPnl(
          openPositionDoc.average_entry_price,
          openPositionDoc.direction,
          openPositionDoc.open_size,
          price
        );
        const pct = calcProfitPct(
          openPositionDoc.average_entry_price,
          openPositionDoc.direction,
          price
        );
        const extremum = applyExcursion(openPositionDoc, unrealised, pct);
        openPositionDoc.max_up = extremum.max_up;
        openPositionDoc.max_down = extremum.max_down;
        openPositionDoc.max_up_pct = extremum.max_up_pct;
        openPositionDoc.max_down_pct = extremum.max_down_pct;
        openPositionDoc.unrealised_pnl = unrealised;
      }
      openPositionDoc.trades.push(trade._id);
      await openPositionDoc.save({ session });
      linkedPositionId = openPositionDoc._id;
      redisOps.push({ type: "sync", position: openPositionDoc.toObject() });
    } else if (isScaleIn || isPartialClose || isFullClose) {
      // No open position doc found (e.g. pre-Position trades) — open a synthetic
      // position only when we end non-zero so future ticks can track.
      if (newPositionSize !== 0) {
        const direction = directionFromSignedSize(newPositionSize);
        const entryPrice = newAverageEntryPrice > 0 ? newAverageEntryPrice : price;
        const [created] = await Position.create(
          [
            buildPositionBase(
              tradeData,
              account,
              deployment,
              direction,
              newPositionSize,
              entryPrice,
              price,
              type_of_order,
              commission
            ),
          ],
          { session }
        );
        created.trades.push(trade._id);
        if (pnl) {
          created.realised_pnl = pnl;
        }
        await created.save({ session });
        linkedPositionId = created._id;
        redisOps.push({ type: "sync", position: created.toObject() });
      }
    }

    if (linkedPositionId) {
      trade.position_id = linkedPositionId;
      await trade.save({ session });
    }

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

    // Redis writes only after Mongo commit (edge case #2)
    for (const op of redisOps) {
      try {
        if (op.type === "sync") {
          await syncOpenPositionToRedis(op.position);
        } else if (op.type === "remove") {
          await removeOpenPositionFromRedis(op.position);
        }
      } catch (err) {
        console.error(`[createTrade] Redis sync failed after commit: ${err.message}`);
      }
    }

    // After a full flat close, flush any deferred symbol_control re-resolve
    if (isFullClose && deployment?._id) {
      try {
        const { flushPendingSymbolResolve } = await import("./deployment.js");
        await flushPendingSymbolResolve(deployment._id);
      } catch (err) {
        console.error(
          `[createTrade] Failed to flush pending symbol resolve for ${deployment._id}: ${err.message}`
        );
      }
    }

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
