import { jwtService } from "../iam/index.js";

export const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = jwtService;
