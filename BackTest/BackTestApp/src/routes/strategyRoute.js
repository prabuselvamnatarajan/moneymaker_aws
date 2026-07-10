import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createStrategyController,
  getAllStrategiesController,
  getStrategyByIdController,
  updateStrategyController,
  deleteStrategyController,
} from "../controllers/strategy.js";

const router = express.Router();

// All endpoints require authentication
router.post("/", authenticate, createStrategyController);
router.get("/", authenticate, getAllStrategiesController);
router.get("/:id", authenticate, getStrategyByIdController);
router.put("/:id", authenticate, updateStrategyController);
router.patch("/:id", authenticate, updateStrategyController);
router.delete("/:id", authenticate, deleteStrategyController);

export default router;
