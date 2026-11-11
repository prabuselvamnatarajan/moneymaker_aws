import mongoose from "mongoose";
import User from "../models/user.js";
import bcrypt from "bcryptjs";

async function isUserAdmin(userId) {
  const Role = mongoose.model("Role");
  const user = await User.findById(userId).lean();
  if (!user) return false;
  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  return roles.some(r => r.name === "admin");
}

export const createUserController = async (req, res, next) => {
  try {
    const { username, name, email, password } = req.body;
    if (!email || !password || !username || !name) {
      return res.status(400).json({ message: "All fields are required" });
    }
    
    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) {
      return res.status(409).json({ message: "Email is already taken" });
    }

    const usernameExists = await User.findOne({ username });
    if (usernameExists) {
      return res.status(409).json({ message: "Username is already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const Role = mongoose.model("Role");
    const defaultRole = await Role.findOne({ name: "user" });

    const user = new User({
      username,
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      roles: defaultRole ? [defaultRole._id] : [],
      is_active: true
    });

    await user.save();

    try {
      const { initializeUserAccounts } = await import("../utils/accountInitializer.js");
      await initializeUserAccounts(user._id);
    } catch (initErr) {
      console.error("Failed to initialize predefined accounts for user:", user._id, initErr);
    }

    const created = await User.findById(user._id).select("-password").populate("roles").lean();
    res.status(201).json({
      message: "User created successfully",
      data: created
    });
  } catch (err) {
    next(err);
  }
};

export const getAllUsersController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const admin = await isUserAdmin(userId);
    if (!admin) {
      const user = await User.findById(userId).select("-password").populate("roles").lean();
      return res.status(200).json({
        message: "Profile retrieved successfully",
        data: user
      });
    }
    const users = await User.find().select("-password").populate("roles").lean();
    res.status(200).json({
      message: "Users retrieved successfully",
      data: users
    });
  } catch (err) {
    next(err);
  }
};

export const getUserByIdController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const targetId = req.params.id;
    const admin = await isUserAdmin(userId);

    if (userId !== targetId && !admin) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    const user = await User.findById(targetId).select("-password").populate("roles").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User retrieved successfully",
      data: user
    });
  } catch (err) {
    next(err);
  }
};

export const updateUserController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const targetId = req.params.id;
    const admin = await isUserAdmin(userId);

    if (userId !== targetId && !admin) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { name, username, email, password, is_active } = req.body;

    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const emailExists = await User.findOne({ email: email.toLowerCase() });
      if (emailExists) return res.status(409).json({ message: "Email is already taken" });
      user.email = email.toLowerCase();
    }

    if (username && username !== user.username) {
      const usernameExists = await User.findOne({ username });
      if (usernameExists) return res.status(409).json({ message: "Username is already taken" });
      user.username = username;
    }

    if (name) user.name = name;
    if (password) user.password = await bcrypt.hash(password, 10);
    if (is_active !== undefined && admin) user.is_active = is_active;

    await user.save();
    const updated = await User.findById(user._id).select("-password").populate("roles").lean();
    res.status(200).json({
      message: "User updated successfully",
      data: updated
    });
  } catch (err) {
    next(err);
  }
};

export const deleteUserController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const targetId = req.params.id;
    const admin = await isUserAdmin(userId);

    if (userId !== targetId && !admin) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    const user = await User.findByIdAndDelete(targetId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User deleted successfully",
      data: user
    });
  } catch (err) {
    next(err);
  }
};
