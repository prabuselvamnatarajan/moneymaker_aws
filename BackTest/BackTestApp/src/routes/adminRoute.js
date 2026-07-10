import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import { isAdmin } from "../middlewares/adminMiddleware.js";
import {
  getUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  getUserAccounts,
  createUserAccount,
  getUserStrategies,
  createUserStrategy,
  getUserDeployments,
  getUserTrades,
  getUserLedger
} from "../controllers/admin.js";

const router = express.Router();

router.use(authenticate);
router.use(isAdmin);

// User Management
router.get("/users", getUsers);
router.post("/users", createUser);
router.get("/users/:userId", getUserById);
router.put("/users/:userId", updateUser);
router.patch("/users/:userId", updateUser);
router.delete("/users/:userId", deleteUser);

// User Resources Management
router.get("/users/:userId/accounts", getUserAccounts);
router.post("/users/:userId/accounts", createUserAccount);
router.get("/users/:userId/strategies", getUserStrategies);
router.post("/users/:userId/strategies", createUserStrategy);
router.get("/users/:userId/deployments", getUserDeployments);
router.get("/users/:userId/trades", getUserTrades);
router.get("/users/:userId/ledger", getUserLedger);

export default router;
