import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createBrokerController,
  getAllBrokersController,
} from "../controllers/broker.js";

const router = express.Router();

router.get("/", authenticate, getAllBrokersController);
router.post("/", authenticate, createBrokerController);

export default router;
