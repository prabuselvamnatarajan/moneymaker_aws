import { signup, login } from "./controllers/authController.js";
import { setup, verifySetup, loginVerify } from "./controllers/mfaController.js";
import { authenticate } from "./middlewares/authMiddleware.js";
import * as authService from "./services/authService.js";
import * as mfaService from "./services/mfaService.js";
import * as sessionService from "./services/sessionService.js";
import * as jwtService from "./utils/jwtService.js";
import * as config from "./config.js";

export {
  signup,
  login,
  setup,
  verifySetup,
  loginVerify,
  authenticate,
  authService,
  mfaService,
  sessionService,
  jwtService,
  config,
};
