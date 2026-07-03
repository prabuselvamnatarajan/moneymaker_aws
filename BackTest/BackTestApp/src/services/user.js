import User from "../models/user.js";
import { authService } from "../iam/index.js";
import { initializeUserAccounts } from "../utils/accountInitializer.js";

const { getDefaultUserRoleId } = authService;

export const createUser = async (userData) => {
  const payload = { ...userData };
  if (!Array.isArray(payload.roles) || payload.roles.length === 0) {
    payload.roles = [await getDefaultUserRoleId()];
  }

  const user = new User(payload);
  const savedUser = await user.save();

  try {
    await initializeUserAccounts(savedUser._id);
  } catch (initErr) {
    console.error("Failed to initialize predefined accounts for user:", savedUser._id, initErr);
  }

  return savedUser;
};

export const getAllUsers = async (userId, filters = {}) => {
  // Users can only see their own profile
  return await User.findById(userId);
};

export const getUserById = async (userId, id) => {
  // Users can only access their own profile
  if (userId !== id) {
    return null; // Unauthorized access
  }
  return await User.findById(id);
};

export const updateUser = async (userId, id, updateData) => {
  // Users can only update their own profile
  if (userId !== id) {
    return null; // Unauthorized access
  }
  return await User.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });
};

export const deleteUser = async (userId, id) => {
  // Users can only delete their own account
  if (userId !== id) {
    return null; // Unauthorized access
  }
  return await User.findByIdAndDelete(id);
};
