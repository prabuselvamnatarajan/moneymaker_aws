import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createSymbolController,
  getAllSymbolsController,
  getSymbolByIdController,
  updateSymbolController,
  deleteSymbolController
} from "../controllers/symbol.js";

const router = express.Router();

router.post("/", authenticate, createSymbolController);
router.get("/", authenticate, getAllSymbolsController);
router.get("/:id", authenticate, getSymbolByIdController);
router.put("/:id", authenticate, updateSymbolController);
router.patch("/:id", authenticate, updateSymbolController);
router.delete("/:id", authenticate, deleteSymbolController);

export default router;
