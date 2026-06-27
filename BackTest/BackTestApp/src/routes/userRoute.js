import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  createUserController,
  getAllUsersController,
  getUserByIdController,
  updateUserController,
  deleteUserController,
} from "../controllers/user.js";

const router = express.Router();

// Public endpoint - create user (signup)
router.post("/", createUserController);

// Protected endpoints - require authentication
router.get("/", authenticate, getAllUsersController);
router.get("/:id", authenticate, getUserByIdController);
router.put("/:id", authenticate, updateUserController);
router.delete("/:id", authenticate, deleteUserController);

export default router;
