import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
} from "../services/user.js";

export const createUserController = async (req, res) => {
  try {
    const result = await createUser(req.body);
    res.status(201).json({
      message: "User created successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to create user",
      error: err.message,
    });
  }
};

export const getAllUsersController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getAllUsers(userId, req.query);
    res.status(200).json({
      message: "User profile retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch user",
      error: err.message,
    });
  }
};

export const getUserByIdController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await getUserById(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "User not found or unauthorized" });
    }

    res.status(200).json({
      message: "User retrieved successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to fetch user",
      error: err.message,
    });
  }
};

export const updateUserController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await updateUser(userId, req.params.id, req.body);
    if (!result) {
      return res.status(404).json({ message: "User not found or unauthorized" });
    }

    res.status(200).json({
      message: "User updated successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to update user",
      error: err.message,
    });
  }
};

export const deleteUserController = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const result = await deleteUser(userId, req.params.id);
    if (!result) {
      return res.status(404).json({ message: "User not found or unauthorized" });
    }

    res.status(200).json({
      message: "User deleted successfully",
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      message: "Failed to delete user",
      error: err.message,
    });
  }
};
