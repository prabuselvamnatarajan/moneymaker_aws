import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createDeploymentController,
  getAllDeploymentsController,
  getDeploymentByIdController,
  updateDeploymentController,
  deleteDeploymentController,
  startDeploymentController,
  stopDeploymentController,
  pauseDeploymentController,
  resumeDeploymentController,
  restartDeploymentController,
  getDeploymentStatusController,
  getDeploymentLogsController,
  getDeploymentMetricsController,
  getDeploymentAnalysisController,
} from "../controllers/deployment.js";

const router = express.Router();

// CRUD
router.post("/", authenticate, createDeploymentController);
router.get("/", authenticate, getAllDeploymentsController);
router.get("/:id", authenticate, getDeploymentByIdController);
router.put("/:id", authenticate, updateDeploymentController);
router.patch("/:id", authenticate, updateDeploymentController);
router.delete("/:id", authenticate, deleteDeploymentController);

// Lifecycle actions
router.post("/:id/start", authenticate, startDeploymentController);
router.post("/:id/stop", authenticate, stopDeploymentController);
router.post("/:id/pause", authenticate, pauseDeploymentController);
router.post("/:id/resume", authenticate, resumeDeploymentController);
router.post("/:id/restart", authenticate, restartDeploymentController);

// Monitoring
router.get("/:id/status", authenticate, getDeploymentStatusController);
router.get("/:id/logs", authenticate, getDeploymentLogsController);
router.get("/:id/metrics", authenticate, getDeploymentMetricsController);
router.get("/:id/analysis", authenticate, getDeploymentAnalysisController);

export default router;
