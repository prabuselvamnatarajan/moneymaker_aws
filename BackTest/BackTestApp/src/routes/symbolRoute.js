import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createSymbolController,
  getAllSymbolsController,
  getSymbolByIdController,
  updateSymbolController,
  deleteSymbolController,
  bulkCreateSymbolController,
  getSymbolCandlesController
} from "../controllers/symbol.js";

const router = express.Router();

router.post("/bulk", authenticate, bulkCreateSymbolController);
router.post("/", authenticate, createSymbolController);
router.get("/", authenticate, getAllSymbolsController);
router.get("/:symbol/candles", authenticate, getSymbolCandlesController);
router.get("/:id", authenticate, getSymbolByIdController);
router.put("/:id", authenticate, updateSymbolController);
router.patch("/:id", authenticate, updateSymbolController);
router.delete("/:id", authenticate, deleteSymbolController);

export default router;
