import mongoose from "mongoose";
import { checkAdmin } from "../utils/roleHelper.js";

export async function isAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userId = req.user._id || req.user.id;
    const hasAdmin = await checkAdmin(userId);

    if (!hasAdmin) {
      return res.status(403).json({ message: "Forbidden: Administrator access required" });
    }

    next();
  } catch (error) {
    next(error);
  }
}
