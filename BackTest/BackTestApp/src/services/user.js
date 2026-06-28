import User from "../models/user.js";

const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { authService } = await import(iamRoot);
const { getDefaultUserRoleId } = authService;

export const createUser = async (userData) => {
  const payload = { ...userData };
  if (!Array.isArray(payload.roles) || payload.roles.length === 0) {
    payload.roles = [await getDefaultUserRoleId()];
  }

  const user = new User(payload);
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
