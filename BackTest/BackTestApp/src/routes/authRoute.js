import express from "express";
import {
  signup,
  login,
  logout,
  refreshToken,
  changePassword,
  forgotPassword,
  resetPassword
} from "../controllers/auth.js";

import {
  setup,
  verifySetup,
  loginVerify,
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

// MFA endpoints
router.post("/mfa/setup", authenticate, setup);
router.post("/mfa/verify-setup", authenticate, verifySetup);
router.post("/mfa/login-verify", loginVerify);

export default router;
