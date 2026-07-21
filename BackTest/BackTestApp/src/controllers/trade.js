import { createTrade, getAllTrades, getTradeById, deleteTrade } from "../services/trade.js";

export const createTradeController = async (req, res, next) => {
  try {
    const tradeData = { ...req.body };

    if (req.serviceAuth) {
      // Internal callers: prefer body.user_id, else X-User-Id from middleware.
      const resolvedUserId = tradeData.user_id || req.auth?.userId;
      if (!resolvedUserId) {
        return res.status(400).json({ message: "user_id is required (body or X-User-Id header)" });
      }
      tradeData.user_id = resolvedUserId;
    } else if (req.auth && req.auth.userId) {
      // JWT auth: always bind trade to the authenticated user.
      tradeData.user_id = req.auth.userId;
    } else if (!tradeData.user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const result = await createTrade(tradeData);
    res.status(201).json({
      message: "✅ Trade executed successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllTradesController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllTrades(userId, req.query);
    res.status(200).json({
      message: "Trades retrieved successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getTradeByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getTradeById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Trade not found" });
    }
    res.status(200).json({
      message: "Trade retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteTradeController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteTrade(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Trade not found or unauthorized" });
    }
    res.status(200).json({
      message: "Trade deleted successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
