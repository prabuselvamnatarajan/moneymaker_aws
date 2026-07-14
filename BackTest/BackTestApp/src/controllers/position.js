import { getAllPositions, getPositionById } from "../services/position.js";

export const getAllPositionsController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllPositions(userId, req.query);
    res.status(200).json({
      message: "Positions retrieved successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPositionByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await getPositionById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Position not found" });
    }
    res.status(200).json({
      message: "Position retrieved successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
