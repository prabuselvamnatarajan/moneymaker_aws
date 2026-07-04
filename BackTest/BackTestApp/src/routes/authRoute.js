import express from "express";
import {
  signup,
  login,
  logout,
  refreshToken,
  changePassword,
  forgotPassword,
  resetPassword,
  getSessions,
  revokeSession,
  revokeOtherSessions,
  getApiKeys,
  createApiKey,
  revokeApiKey
} from "../controllers/auth.js";

import {
  setup,
  verifySetup,
  loginVerify,
  disable,
  authenticate
} from "../iam/index.js";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", authenticate, logout);
router.post("/refresh-token", refreshToken);
router.post("/change-password", authenticate, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Active sessions endpoints
router.get("/sessions", authenticate, getSessions);
router.delete("/sessions/others", authenticate, revokeOtherSessions);
router.delete("/sessions/:sessionId", authenticate, revokeSession);

// API Keys endpoints
router.get("/api-keys", authenticate, getApiKeys);
router.post("/api-keys", authenticate, createApiKey);
router.delete("/api-keys/:keyId", authenticate, revokeApiKey);

// MFA endpoints
router.post("/mfa/setup", authenticate, setup);
router.post("/mfa/verify-setup", authenticate, verifySetup);
router.post("/mfa/login-verify", loginVerify);
router.post("/mfa/disable", authenticate, disable);

export default router;
