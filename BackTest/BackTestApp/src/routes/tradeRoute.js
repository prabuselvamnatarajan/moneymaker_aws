import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import { authenticateOrServiceToken } from "../middlewares/serviceTokenMiddleware.js";
import {
  createTradeController,
  getAllTradesController,
  getTradeByIdController,
  deleteTradeController,
} from "../controllers/trade.js";

const router = express.Router();

// REST API endpoints
router.post("/", authenticateOrServiceToken, createTradeController);
router.get("/", authenticate, getAllTradesController);
router.get("/:id", authenticate, getTradeByIdController);
router.delete("/:id", authenticate, deleteTradeController);

export default router;
