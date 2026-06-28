import { getAllLedger, getLedgerById } from "../services/ledger.js";

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
