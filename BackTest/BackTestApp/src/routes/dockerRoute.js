import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import { isAdmin } from "../middlewares/adminMiddleware.js";
import { getContainers, getContainerLogs } from "../controllers/docker.js";

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(isAdmin);

// Get list of application containers
router.get("/containers", getContainers);

// Get logs for a specific container
router.get("/containers/:containerId/logs", getContainerLogs);

export default router;
