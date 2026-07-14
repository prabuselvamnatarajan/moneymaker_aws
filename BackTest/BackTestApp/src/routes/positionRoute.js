import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  getAllPositionsController,
  getPositionByIdController,
} from "../controllers/position.js";

const router = express.Router();

router.get("/", authenticate, getAllPositionsController);
router.get("/:id", authenticate, getPositionByIdController);

export default router;
