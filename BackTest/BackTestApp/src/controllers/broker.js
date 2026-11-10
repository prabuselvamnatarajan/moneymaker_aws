import mongoose from "mongoose";
import { createBroker, getAllBrokers, updateBroker, deleteBroker } from "../services/broker.js";

async function isUserAdmin(userId) {
  const User = mongoose.model("User");
  const Role = mongoose.model("Role");
  // ⚡ Bolt: Added .lean() to simple read-only queries for role extraction to save memory overhead
  const user = await User.findById(userId).lean();
  if (!user) return false;
  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  return roles.some(r => r.name === "admin");
}

export const createBrokerController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const result = await createBroker(userId, req.body);
    res.status(201).json({
      message: "Broker created successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllBrokersController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const isAdmin = await isUserAdmin(userId);
    const result = await getAllBrokers(userId, isAdmin);
    res.status(200).json({
      message: "Brokers retrieved successfully",
      items: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateBrokerController = async (req, res, next) => {
  try {
    const brokerId = req.params.id;
    const userId = req.auth.userId;
    const isAdmin = await isUserAdmin(userId);
    const result = await updateBroker(brokerId, userId, isAdmin, req.body);
    res.status(200).json({
      message: "Broker updated successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteBrokerController = async (req, res, next) => {
  try {
    const brokerId = req.params.id;
    const userId = req.auth.userId;
    const isAdmin = await isUserAdmin(userId);
    await deleteBroker(brokerId, userId, isAdmin);
    res.status(200).json({
      message: "Broker deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};
