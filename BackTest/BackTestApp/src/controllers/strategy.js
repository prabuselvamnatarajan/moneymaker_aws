import {
  createStrategy,
  getAllStrategies,
  getStrategyById,
  updateStrategy,
  deleteStrategy,
} from "../services/strategy.js";
import { checkAdmin } from "../utils/roleHelper.js";

export const createStrategyController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await createStrategy(userId, req.body);
    res.status(201).json({
      message: "Strategy created successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllStrategiesController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await getAllStrategies(userId, req.query, isAdminUser);
    res.status(200).json({
      message: "Strategies retrieved successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getStrategyByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await getStrategyById(userId, req.params.id, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Strategy not found" });
    }

    res.status(200).json({
      message: "Strategy retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateStrategyController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await updateStrategy(userId, req.params.id, req.body, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Strategy not found or unauthorized" });
    }

    res.status(200).json({
      message: "Strategy updated successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteStrategyController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdminUser = await checkAdmin(userId);
    const result = await deleteStrategy(userId, req.params.id, isAdminUser);
    if (!result) {
      return res.status(404).json({ message: "Strategy not found or unauthorized" });
    }

    res.status(200).json({
      message: "Strategy deleted successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
