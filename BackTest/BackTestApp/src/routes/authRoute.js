import express from "express";

const iamRoot = process.env.IAM_ROOT || "../../MicroServices/Shared/IAM/index.js";

const {
  signup,
  login,
  setup,
  verifySetup,
  loginVerify,
  authenticate,
} = await import(iamRoot);

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/mfa/setup", authenticate, setup);
router.post("/mfa/verify-setup", authenticate, verifySetup);
router.post("/mfa/login-verify", loginVerify);

export default router;
