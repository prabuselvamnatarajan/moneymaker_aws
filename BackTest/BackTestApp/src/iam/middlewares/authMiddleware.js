import * as authService from "../services/authService.js";
import * as jwtService from "../utils/jwtService.js";

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const error = new Error("Authorization header missing or invalid");
      error.statusCode = 401;
      throw error;
    }

    const token = authHeader.split(" ")[1];
    let payload;
    try {
      payload = jwtService.verifyAccessToken(token);
    } catch (verifyError) {
      const error = new Error("Invalid or expired access token");
      error.statusCode = 401;
      throw error;
    }

    const user = await authService.findUserById(payload.userId);

    if (!user) {
      const error = new Error("Invalid access token");
      error.statusCode = 401;
      throw error;
    }

    req.auth = {
      userId: user._id.toString(),
      email: user.email,
      sessionID: payload.sessionID,
      isMfaEnabled: user.is_mfa_enabled,
    };
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
