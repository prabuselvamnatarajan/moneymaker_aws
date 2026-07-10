import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createAccountController,
  getAllAccountsController,
  getAccountByIdController,
  updateAccountController,
  deleteAccountController,
  getAccountBalanceController
} from "../controllers/account.js";

const router = express.Router();

router.post("/", authenticate, createAccountController);
router.get("/", authenticate, getAllAccountsController);
router.get("/:id", authenticate, getAccountByIdController);
router.put("/:id", authenticate, updateAccountController);
router.patch("/:id", authenticate, updateAccountController);
router.delete("/:id", authenticate, deleteAccountController);
router.get("/:id/balance", authenticate, getAccountBalanceController);

export default router;
