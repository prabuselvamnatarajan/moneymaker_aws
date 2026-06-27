import {
  createDeployment,
  getAllDeployments,
  getDeploymentById,
  updateDeployment,
  deleteDeployment,
} from "../services/deployment.js";

export const createDeploymentController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await createDeployment(userId, req.body);
    res.status(201).json({
      message: "Deployment created successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to create deployment",
      error: err.message,
    });
  }
};

export const getAllDeploymentsController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllDeployments(userId, req.query);
    res.status(200).json({
      message: "Deployments retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch deployments",
      error: err.message,
    });
  }
};

export const getDeploymentByIdController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getDeploymentById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found" });
    }

    res.status(200).json({
      message: "Deployment retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch deployment",
      error: err.message,
    });
  }
};

export const updateDeploymentController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await updateDeployment(userId, req.params.id, req.body);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found or unauthorized" });
    }

    res.status(200).json({
      message: "Deployment updated successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to update deployment",
      error: err.message,
    });
  }
};

export const deleteDeploymentController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteDeployment(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Deployment not found or unauthorized" });
    }

    res.status(200).json({
      message: "Deployment deleted successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to delete deployment",
      error: err.message,
    });
  }
};
