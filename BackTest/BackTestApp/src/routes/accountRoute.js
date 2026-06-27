import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createAccountController,
  getAllAccountsController,
  getAccountByIdController,
  updateAccountController,
  deleteAccountController,
} from "../controllers/account.js";

const router = express.Router();

// All endpoints require authentication
router.post("/", authenticate, createAccountController);
router.get("/", authenticate, getAllAccountsController);
router.get("/:id", authenticate, getAccountByIdController);
router.put("/:id", authenticate, updateAccountController);
router.delete("/:id", authenticate, deleteAccountController);

export default router;
