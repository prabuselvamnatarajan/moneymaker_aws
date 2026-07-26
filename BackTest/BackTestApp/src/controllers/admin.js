import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import Account from "../models/account.js";
import Strategy from "../models/strategy.js";
import Deployment from "../models/deployment.js";
import Trade from "../models/trade.js";
import Ledger from "../models/ledger.js";
import { parseQueryParams } from "../utils/queryHelper.js";

// --- User Management ---
export const getUsers = async (req, res, next) => {
  try {
    const { filter, skip, limit, sort, page } = parseQueryParams(req.query, {
      defaultSort: "created_at",
      dateField: "created_at",
      searchFields: ["name", "username", "email"]
    });
    const items = await User.find(filter).sort(sort).skip(skip).limit(limit).select("-password").populate("roles");
    const total = await User.countDocuments(filter);
    res.status(200).json({
      message: "Users retrieved successfully",
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const { username, name, email, password, roles, is_active } = req.body;
    if (!email || !password || !username || !name) {
      return res.status(400).json({ message: "Username, name, email, and password are required" });
    }

    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) return res.status(409).json({ message: "Email is already taken" });

    const usernameExists = await User.findOne({ username });
    if (usernameExists) return res.status(409).json({ message: "Username is already taken" });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    let userRoles;
    if (Array.isArray(roles)) {
      // Honor explicit [] — used to create users with no assignable role for login tests.
      userRoles = roles;
    } else {
      const Role = mongoose.model("Role");
      const defaultRole = await Role.findOne({ name: "user" });
      userRoles = defaultRole ? [defaultRole._id] : [];
    }

    const newUser = new User({
      username,
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      roles: userRoles,
      is_active: is_active !== undefined ? is_active : true
    });

    await newUser.save();

    try {
      const { initializeUserAccounts } = await import("../utils/accountInitializer.js");
      await initializeUserAccounts(newUser._id);
    } catch (initErr) {
      console.error("Failed to initialize predefined accounts for user:", newUser._id, initErr);
    }

    const created = await User.findById(newUser._id).select("-password").populate("roles");
    res.status(201).json({ message: "User created successfully", data: created });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).select("-password").populate("roles");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ message: "User retrieved successfully", data: user });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { name, username, email, password, roles, is_active } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

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
    if (roles && Array.isArray(roles)) user.roles = roles;
    if (is_active !== undefined) user.is_active = is_active;

    await user.save();
    const updated = await User.findById(user._id).select("-password").populate("roles");
    res.status(200).json({ message: "User updated successfully", data: updated });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// --- User's Resources ---

export const getUserAccounts = async (req, res, next) => {
  try {
    const { filter, skip, limit, sort, page } = parseQueryParams(req.query, {
      defaultSort: "created_on",
      dateField: "created_on",
      searchFields: ["account_name", "description"]
    });
    filter.user_id = req.params.userId;
    const items = await Account.find(filter).sort(sort).skip(skip).limit(limit);
    const total = await Account.countDocuments(filter);
    res.status(200).json({
      message: "User accounts retrieved successfully",
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
};

export const createUserAccount = async (req, res, next) => {
  try {
    const newAccount = new Account({ ...req.body, user_id: req.params.userId });
    await newAccount.save();
    res.status(201).json({ message: "User account created successfully", data: newAccount });
  } catch (error) {
    next(error);
  }
};

export const getUserStrategies = async (req, res, next) => {
  try {
    const { filter, skip, limit, sort, page } = parseQueryParams(req.query, {
      defaultSort: "created_at",
      dateField: "created_at",
      searchFields: ["strategy_name", "strategy_description"]
    });
    filter.user_id = req.params.userId;
    const items = await Strategy.find(filter).sort(sort).skip(skip).limit(limit);
    const total = await Strategy.countDocuments(filter);
    res.status(200).json({
      message: "User strategies retrieved successfully",
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
};

export const createUserStrategy = async (req, res, next) => {
  try {
    const newStrategy = new Strategy({ ...req.body, user_id: req.params.userId });
    await newStrategy.save();
    res.status(201).json({ message: "User strategy created successfully", data: newStrategy });
  } catch (error) {
    next(error);
  }
};

export const getUserDeployments = async (req, res, next) => {
  try {
    const { filter, skip, limit, sort, page } = parseQueryParams(req.query, {
      defaultSort: "created_at",
      dateField: "created_at",
      searchFields: ["symbol", "deployment_name"]
    });
    filter.user_id = req.params.userId;
    const items = await Deployment.find(filter).sort(sort).skip(skip).limit(limit);
    const total = await Deployment.countDocuments(filter);
    res.status(200).json({
      message: "User deployments retrieved successfully",
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
};

export const getUserTrades = async (req, res, next) => {
  try {
    const { filter, skip, limit, sort, page } = parseQueryParams(req.query, {
      defaultSort: "created_at",
      dateField: "created_at",
      searchFields: ["symbol"]
    });
    filter.user_id = req.params.userId;
    const items = await Trade.find(filter).sort(sort).skip(skip).limit(limit);
    const total = await Trade.countDocuments(filter);
    res.status(200).json({
      message: "User trades retrieved successfully",
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
};

export const getUserLedger = async (req, res, next) => {
  try {
    const { filter, skip, limit, sort, page } = parseQueryParams(req.query, {
      defaultSort: "created_on",
      dateField: "created_on",
      searchFields: ["symbol"]
    });
    filter.user_id = req.params.userId;
    const items = await Ledger.find(filter).sort(sort).skip(skip).limit(limit);
    const total = await Ledger.countDocuments(filter);
    res.status(200).json({
      message: "User ledger entries retrieved successfully",
      items,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
};
