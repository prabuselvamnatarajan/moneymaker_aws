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

const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const {
  setup,
  verifySetup,
  loginVerify,
  authenticate
} = await import(iamRoot);

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
