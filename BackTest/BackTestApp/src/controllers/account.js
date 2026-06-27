import {
  createAccount,
  getAllAccounts,
  getAccountById,
  updateAccount,
  deleteAccount,
} from "../services/account.js";

export const createAccountController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await createAccount(userId, req.body);
    res.status(201).json({
      message: "Account created successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to create account",
      error: err.message,
    });
  }
};

export const getAllAccountsController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllAccounts(userId, req.query);
    res.status(200).json({
      message: "Accounts retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch accounts",
      error: err.message,
    });
  }
};

export const getAccountByIdController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getAccountById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.status(200).json({
      message: "Account retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch account",
      error: err.message,
    });
  }
};

export const updateAccountController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await updateAccount(userId, req.params.id, req.body);
    if (!result) {
      return res.status(404).json({ message: "Account not found or unauthorized" });
    }

    res.status(200).json({
      message: "Account updated successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to update account",
      error: err.message,
    });
  }
};

export const deleteAccountController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteAccount(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Account not found or unauthorized" });
    }

    res.status(200).json({
      message: "Account deleted successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to delete account",
      error: err.message,
    });
  }
};
