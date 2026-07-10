import {
  getAllLedger,
  getLedgerById,
  depositBalance,
  withdrawBalance,
  transferBalance,
} from "../services/ledger.js";

export const getAllLedgerController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllLedger(userId, req.query);
    res.status(200).json({
      message: "Ledger entries retrieved successfully",
      ...result
    });
  } catch (error) {
    next(error);
  }
};

export const getLedgerByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getLedgerById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Ledger entry not found" });
    }
    res.status(200).json({
      message: "Ledger entry retrieved successfully",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const depositController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { accountId, amount, description } = req.body;
    const result = await depositBalance(userId, accountId, Number(amount), description);
    res.status(200).json({
      message: "Deposit successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const withdrawController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { accountId, amount, description } = req.body;
    const result = await withdrawBalance(userId, accountId, Number(amount), description);
    res.status(200).json({
      message: "Withdrawal successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const transferController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { fromAccountId, toAccountId, amount, description } = req.body;
    const result = await transferBalance(userId, fromAccountId, toAccountId, Number(amount), description);
    res.status(200).json({
      message: "Transfer successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
