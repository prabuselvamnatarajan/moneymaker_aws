import { createTrade } from "../services/trade.js";

export const createTradeController = async (req, res) => {
  try {
    const tradeData = req.body;
    console.log("Received trade data:", req.body);
    const result = await createTrade(tradeData);
    res.status(201).json({
      message: "✅ Trade executed successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "❌ Trade failed",
      error: err.message,
    });
  }
};
