import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import crypto from "crypto";

import { login, sessionService, jwtService, authService } from "../iam/index.js";
import { initializeUserAccounts } from "../utils/accountInitializer.js";
import Session from "../iam/models/session.js";
import PersonalAccessToken from "../iam/models/personalAccessToken.js";

export { login };

export const signup = async (req, res, next) => {
  try {
    const { username, name, email, password } = req.body || {};
    if (!email || !password || !username || !name) {
      const error = new Error("Email, username, name, and password are required");
      error.statusCode = 400;
      throw error;
    }

    const user = await authService.createUser({ username, name, email, password });
    
    try {
      await initializeUserAccounts(user._id);
    } catch (initErr) {
      console.error("Failed to initialize predefined accounts for user:", user._id, initErr);
    }

    res.status(201).json({ message: "Sign Up success!" });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.sessionID) {
      return res.status(400).json({ message: "No active session to log out" });
    }
    await sessionService.endSession(req.auth.sessionID, req.user);
    res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    let payload;
    try {
      payload = jwtService.verifyRefreshToken(token);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    const session = await sessionService.getSessionById(payload.sessionID);
    if (!session) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    const User = mongoose.model("User");
    const user = await User.findById(payload.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const newPayload = {
      userId: user._id.toString(),
      email: user.email,
      sessionID: payload.sessionID,
    };

    const accessToken = jwtService.signAccessToken(newPayload);
    res.status(200).json({
      message: "Access token refreshed successfully",
      accessToken
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }

    const isMatch = await authService.validatePassword(currentPassword, req.user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid current password" });
    }

    req.user.password = await bcrypt.hash(newPassword, 10);
    await req.user.save();

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const User = mongoose.model("User");
    const user = await User.findOne({ email: email.toLowerCase() });

    const genericMessage =
      "If an account exists with that email, password reset instructions have been sent.";

    if (user) {
      const secret = process.env.JWT_ACCESS_SECRET || "iam-access-secret";
      const token = jwt.sign(
        { userId: user._id.toString(), purpose: "password-reset" },
        secret,
        { expiresIn: "15m" }
      );

      if (process.env.NODE_ENV !== "production") {
        console.log(`Password reset token for ${email}: ${token}`);
      }
      // TODO: deliver token via email in production
    }

    res.status(200).json({ message: genericMessage });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password are required" });
    }

    let payload;
    try {
      const secret = process.env.JWT_ACCESS_SECRET || "iam-access-secret";
      payload = jwt.verify(token, secret);
    } catch (err) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    if (payload.purpose !== "password-reset") {
      return res.status(400).json({ message: "Invalid token purpose" });
    }

    const User = mongoose.model("User");
    const user = await User.findById(payload.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    next(error);
  }
};

export const getSessions = async (req, res, next) => {
  try {
    const sessions = await Session.find({ user: req.auth.userId, active: true }).sort({ startedAt: -1 });
    const formattedSessions = sessions.map(s => ({
      id: s._id.toString(),
      device: s.device,
      os: s.os,
      browser: s.browser,
      ip: s.ip,
      location: s.location,
      lastActive: "Just now",
      current: s._id.toString() === req.auth.sessionID
    }));
    res.status(200).json(formattedSessions);
  } catch (error) {
    next(error);
  }
};

export const revokeSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ _id: sessionId, user: req.auth.userId, active: true });
    if (!session) {
      return res.status(404).json({ message: "Session not found or already revoked" });
    }
    
    session.active = false;
    session.endedAt = new Date();
    await session.save();

    res.status(200).json({ message: "Session revoked successfully" });
  } catch (error) {
    next(error);
  }
};

export const revokeOtherSessions = async (req, res, next) => {
  try {
    await Session.updateMany(
      { user: req.auth.userId, _id: { $ne: req.auth.sessionID }, active: true },
      { $set: { active: false, endedAt: new Date() } }
    );
    res.status(200).json({ message: "All other sessions revoked successfully" });
  } catch (error) {
    next(error);
  }
};

export const getApiKeys = async (req, res, next) => {
  try {
    const keys = await PersonalAccessToken.find({ user: req.auth.userId, active: true }).sort({ createdAt: -1 });
    const formattedKeys = keys.map(k => ({
      id: k._id.toString(),
      name: k.name,
      tokenPrefix: k.tokenPrefix,
      createdAt: k.createdAt.toISOString().split('T')[0],
      lastUsed: k.lastUsedAt ? "Recent" : "Never"
    }));
    res.status(200).json(formattedKeys);
  } catch (error) {
    next(error);
  }
};

export const createApiKey = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: "API key name is required" });
    }

    const randomHex = crypto.randomBytes(16).toString("hex");
    const token = `ct_live_${randomHex}`;
    const tokenPrefix = `${token.substring(0, 12)}...`;

    const newKey = new PersonalAccessToken({
      user: req.auth.userId,
      name,
      token,
      tokenPrefix,
      active: true
    });

    await newKey.save();

    res.status(201).json({
      message: "API key generated successfully",
      key: {
        id: newKey._id.toString(),
        name: newKey.name,
        token: token,
        tokenPrefix: newKey.tokenPrefix,
        createdAt: newKey.createdAt.toISOString().split('T')[0],
        lastUsed: "Never"
      }
    });
  } catch (error) {
    next(error);
  }
};

export const revokeApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const key = await PersonalAccessToken.findOne({ _id: keyId, user: req.auth.userId, active: true });
    if (!key) {
      return res.status(404).json({ message: "API key not found or already revoked" });
    }

    key.active = false;
    await key.save();

    res.status(200).json({ message: "API key revoked successfully" });
  } catch (error) {
    next(error);
  }
};
