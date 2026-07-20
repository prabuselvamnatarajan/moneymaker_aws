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
  getDeploymentCandlesController,
  createSweepSignalLogController,
  getSweepSignalLogsController,
  getSweepSignalStatsController,
  resolveDeploymentSymbolController,
} from "../controllers/deployment.js";
import {
  authenticateOrServiceToken,
  requireServiceToken,
} from "../middlewares/serviceTokenMiddleware.js";

const router = express.Router();

// CRUD
router.post("/", authenticate, createDeploymentController);
router.get("/", authenticate, getAllDeploymentsController);
router.get("/:id", authenticate, getDeploymentByIdController);
router.put("/:id", authenticate, updateDeploymentController);
router.patch("/:id", authenticate, updateDeploymentController);
router.delete("/:id", authenticate, deleteDeploymentController);

// Lifecycle actions
router.post("/:id/start", authenticateOrServiceToken, startDeploymentController);
router.post("/:id/stop", authenticateOrServiceToken, stopDeploymentController);
router.post("/:id/pause", authenticateOrServiceToken, pauseDeploymentController);
router.post("/:id/resume", authenticateOrServiceToken, resumeDeploymentController);
router.post("/:id/restart", authenticateOrServiceToken, restartDeploymentController);

// Monitoring
router.get("/:id/status", authenticate, getDeploymentStatusController);
router.get("/:id/logs", authenticate, getDeploymentLogsController);
router.get("/:id/metrics", authenticate, getDeploymentMetricsController);
router.get("/:id/analysis", authenticate, getDeploymentAnalysisController);
router.get("/:id/candles", authenticate, getDeploymentCandlesController);
router.post("/:id/resolve-symbol", requireServiceToken, resolveDeploymentSymbolController);
router.post("/:id/sweep-signals", authenticateOrServiceToken, createSweepSignalLogController);
router.get("/:id/sweep-signals/stats", authenticate, getSweepSignalStatsController);
router.get("/:id/sweep-signals", authenticate, getSweepSignalLogsController);

export default router;
