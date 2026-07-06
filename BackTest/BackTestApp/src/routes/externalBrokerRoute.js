import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import { isAdmin } from "../middlewares/adminMiddleware.js";
import {
  getAllExternalBrokersController,
  createExternalBrokerController,
  updateExternalBrokerController,
  deleteExternalBrokerController
} from "../controllers/externalBroker.js";

const router = express.Router();

// Get list of external brokers is available to all authenticated users
router.get("/", authenticate, getAllExternalBrokersController);

// CUD operations are restricted to admin
router.post("/", authenticate, isAdmin, createExternalBrokerController);
router.put("/:id", authenticate, isAdmin, updateExternalBrokerController);
router.delete("/:id", authenticate, isAdmin, deleteExternalBrokerController);

export default router;
