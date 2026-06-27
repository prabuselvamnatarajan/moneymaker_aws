import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createDeploymentController,
  getAllDeploymentsController,
  getDeploymentByIdController,
  updateDeploymentController,
  deleteDeploymentController,
} from "../controllers/deployment.js";

const router = express.Router();

// All endpoints require authentication
router.post("/", authenticate, createDeploymentController);
router.get("/", authenticate, getAllDeploymentsController);
router.get("/:id", authenticate, getDeploymentByIdController);
router.put("/:id", authenticate, updateDeploymentController);
router.delete("/:id", authenticate, deleteDeploymentController);

export default router;
