import {
  createSymbol,
  getAllSymbols,
  getSymbolById,
  updateSymbol,
  deleteSymbol,
  bulkCreateSymbols
} from "../services/symbol.js";

export const bulkCreateSymbolController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await bulkCreateSymbols(userId, req.body);
    res.status(200).json({
      message: result.message,
      data: result.data
    });
  } catch (error) {
    next(error);
  }
};

export const createSymbolController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await createSymbol(userId, req.body);
    res.status(201).json({
      message: "Symbol added successfully",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const getAllSymbolsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllSymbols(userId, req.query);
    res.status(200).json({
      message: "Symbols retrieved successfully",
      ...result
    });
  } catch (error) {
    next(error);
  }
};

export const getSymbolByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getSymbolById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Symbol not found" });
    }
    res.status(200).json({
      message: "Symbol retrieved successfully",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const updateSymbolController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await updateSymbol(userId, req.params.id, req.body);
    if (!result) {
      return res.status(404).json({ message: "Symbol not found or unauthorized" });
    }
    res.status(200).json({
      message: "Symbol updated successfully",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSymbolController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteSymbol(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Symbol not found or unauthorized" });
    }
    res.status(200).json({
      message: "Symbol deleted successfully",
      data: result
    });
  } catch (error) {
    next(error);
  }
};
