import Deployment from "../models/deployment.js";
import {
  createDeployment,
  getAllDeployments,
  getDeploymentById,
  updateDeployment,
  deleteDeployment,
  transitionDeployment,
  getDeploymentStatus,
  getDeploymentLogs,
  getDeploymentMetrics,
  getDeploymentAnalysis,
  getDeploymentCandles,
  resolveDeploymentSymbol,
} from "../services/deployment.js";
import {
  createSweepSignalLog,
  getSweepSignalLogs,
  getSweepSignalStats,
} from "../services/sweepSignal.js";

export const createDeploymentController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await createDeployment(userId, req.body);
    res.status(201).json({
      message: "Deployment created successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllDeploymentsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllDeployments(userId, req.query);
    res.status(200).json({
      message: "Deployments retrieved successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getDeploymentByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getDeploymentById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Deployment retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateDeploymentController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await updateDeployment(userId, req.params.id, req.body);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found or unauthorized" });
    }
    res.status(200).json({
      message: "Deployment updated successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteDeploymentController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteDeployment(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found or unauthorized" });
    }
    res.status(200).json({
      message: "Deployment deleted successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// --- Lifecycle Controllers ---

const lifecycleAction = (action) => async (req, res, next) => {
  try {
    let userId = req.auth?.userId;
    if (!userId && req.serviceAuth) {
      const deployment = await Deployment.findById(req.params.id).select("user_id").lean();
      if (!deployment) {
        return res.status(404).json({ message: "Deployment not found" });
      }
      userId = String(deployment.user_id);
    }
    if (!userId) {
      return res.status(400).json({
        message: "Authentication required (JWT or X-Service-Token with resolvable user context)",
      });
    }
    const result = await transitionDeployment(userId, req.params.id, action);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: `Deployment ${action} successful`,
      data: result,
    });
  } catch (err) {
    if (err.message.startsWith("Cannot")) {
      return res.status(409).json({ message: err.message });
    }
    next(err);
  }
};

export const startDeploymentController = lifecycleAction("start");
export const stopDeploymentController = lifecycleAction("stop");
export const pauseDeploymentController = lifecycleAction("pause");
export const resumeDeploymentController = lifecycleAction("resume");
export const restartDeploymentController = lifecycleAction("restart");

// --- Monitoring Controllers ---

export const getDeploymentStatusController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getDeploymentStatus(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Deployment status retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getDeploymentLogsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getDeploymentLogs(userId, req.params.id);
    if (result === null) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Deployment logs retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getDeploymentMetricsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getDeploymentMetrics(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Deployment metrics retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getDeploymentAnalysisController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { start_date, end_date, start_time, end_time } = req.query;

    let startDate = start_date;
    let endDate = end_date;
    let startTime = start_time;
    let endTime = end_time;

    // Backward compatibility:
    // If start_time contains a date (like '2026-07-09') and start_date is not provided
    if (start_time && start_time.includes('-') && !start_date) {
      startDate = start_time;
      startTime = undefined;
    }
    if (end_time && end_time.includes('-') && !end_date) {
      endDate = end_time;
      endTime = undefined;
    }

    const result = await getDeploymentAnalysis(userId, req.params.id, startDate, endDate, startTime, endTime);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Deployment analysis retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getDeploymentCandlesController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { timeframe } = req.query;
    const result = await getDeploymentCandles(userId, req.params.id, timeframe);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Candles retrieved successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const createSweepSignalLogController = async (req, res, next) => {
  try {
    const result = await createSweepSignalLog(req.params.id, req.body);
    res.status(201).json({
      message: "Sweep signal logged",
      data: result,
    });
  } catch (err) {
    if (err.message === "Deployment not found") {
      return res.status(404).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * Internal-only: re-resolve controlled deployment option symbol from stream tick.
 * Requires X-Service-Token. Body: { ltp?, reference_strike? }
 * Does not accept force (position gate cannot be bypassed over HTTP).
 */
export const resolveDeploymentSymbolController = async (req, res, next) => {
  try {
    if (!req.serviceAuth) {
      return res.status(403).json({
        message: "resolve-symbol is restricted to internal service callers",
      });
    }

    if (req.body?.force === true) {
      return res.status(400).json({
        message: "force is not allowed on resolve-symbol",
      });
    }

    const result = await resolveDeploymentSymbol(req.params.id, {
      ltp: req.body?.ltp,
      reference_strike: req.body?.reference_strike,
      force: false,
    });

    res.status(200).json({
      message: result.deferred
        ? "Symbol resolve deferred (open position)"
        : result.unchanged
          ? "Symbol already current"
          : "Deployment symbol resolved",
      data: result,
    });
  } catch (err) {
    if (err.message === "Deployment not found") {
      return res.status(404).json({ message: err.message });
    }
    if (
      err.message.includes("symbol_control") ||
      err.message.includes("Cannot remap")
    ) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const getSweepSignalLogsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getSweepSignalLogs(userId, req.params.id, req.query);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Sweep signals retrieved",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getSweepSignalStatsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getSweepSignalStats(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }
    res.status(200).json({
      message: "Sweep signal stats retrieved",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

