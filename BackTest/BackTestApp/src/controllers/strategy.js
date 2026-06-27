import {
  createStrategy,
  getAllStrategies,
  getStrategyById,
  updateStrategy,
  deleteStrategy,
} from "../services/strategy.js";

export const createStrategyController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await createStrategy(userId, req.body);
    res.status(201).json({
      message: "Strategy created successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to create strategy",
      error: err.message,
    });
  }
};

export const getAllStrategiesController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllStrategies(userId, req.query);
    res.status(200).json({
      message: "Strategies retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch strategies",
      error: err.message,
    });
  }
};

export const getStrategyByIdController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getStrategyById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Strategy not found" });
    }

    res.status(200).json({
      message: "Strategy retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch strategy",
      error: err.message,
    });
  }
};

export const updateStrategyController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await updateStrategy(userId, req.params.id, req.body);
    if (!result) {
      return res.status(404).json({ message: "Strategy not found or unauthorized" });
    }

    res.status(200).json({
      message: "Strategy updated successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to update strategy",
      error: err.message,
    });
  }
};

export const deleteStrategyController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteStrategy(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Strategy not found or unauthorized" });
    }

    res.status(200).json({
      message: "Strategy deleted successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to delete strategy",
      error: err.message,
    });
  }
};
