import User from "../models/user.js";

export const createUser = async (userData) => {
  const user = new User(userData);
  return await user.save();
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
