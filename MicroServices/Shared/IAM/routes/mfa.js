const express = require("express");
const mfaController = require("../controllers/mfaController");
const { authenticate } = require("../middlewares/authMiddleware");

const router = express.Router();
router.post("/mfa/setup", authenticate, mfaController.setup);
router.post("/mfa/verify-setup", authenticate, mfaController.verifySetup);
router.post("/mfa/login-verify", mfaController.loginVerify);

module.exports = router;
