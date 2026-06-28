import {
  createAccount,
  getAllAccounts,
  getAccountById,
  updateAccount,
  deleteAccount,
} from "../services/account.js";
import { checkAdmin } from "../utils/roleHelper.js";

export const createAccountController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await createAccount(userId, req.body);
    res.status(201).json({
      message: "Account created successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllAccountsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await getAllAccounts(userId, req.query, isAdminUser);
    res.status(200).json({
      message: "Accounts retrieved successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAccountByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await getAccountById(userId, req.params.id, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.status(200).json({
      message: "Account retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateAccountController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await updateAccount(userId, req.params.id, req.body, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Account not found or unauthorized" });
    }

    res.status(200).json({
      message: "Account updated successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteAccountController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await deleteAccount(userId, req.params.id, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Account not found or unauthorized" });
    }

    res.status(200).json({
      message: "Account deleted successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAccountBalanceController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await getAccountById(userId, req.params.id, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.status(200).json({
      message: "Account balance retrieved successfully",
      data: {
        account_id: result.account_id,
        current_balance: result.current_balance,
      },
    });
  } catch (err) {
    next(err);
  }
};
