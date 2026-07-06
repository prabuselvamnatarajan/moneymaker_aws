import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createBrokerController,
  getAllBrokersController,
  updateBrokerController,
  deleteBrokerController,
} from "../controllers/broker.js";

const router = express.Router();

router.get("/", authenticate, getAllBrokersController);
router.post("/", authenticate, createBrokerController);
router.put("/:id", authenticate, updateBrokerController);
router.delete("/:id", authenticate, deleteBrokerController);

export default router;
