import express from "express";
import { setup, verifySetup, loginVerify } from "../controllers/mfaController.js";
import { authenticate } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.post("/mfa/setup", authenticate, setup);
router.post("/mfa/verify-setup", authenticate, verifySetup);
router.post("/mfa/login-verify", loginVerify);

export default router;
