import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  getMeController,
  updateMeController,
  deleteMeController
} from "../controllers/me.js";

const router = express.Router();

router.get("/", authenticate, getMeController);
router.patch("/", authenticate, updateMeController);
router.delete("/", authenticate, deleteMeController);

export default router;
