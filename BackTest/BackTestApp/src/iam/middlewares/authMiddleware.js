import * as authService from "../services/authService.js";
import * as jwtService from "../utils/jwtService.js";
import PersonalAccessToken from "../models/personalAccessToken.js";
import Session from "../models/session.js";

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const error = new Error("Authorization header missing or invalid");
      error.statusCode = 401;
      throw error;
    }

    const token = authHeader.split(" ")[1];
    
    // Check if it is a personal access token
    if (token.startsWith("ct_live_") || token.startsWith("ct_test_")) {
      const personalToken = await PersonalAccessToken.findOne({ token, active: true });
      if (!personalToken) {
        const error = new Error("Invalid or revoked personal access token");
        error.statusCode = 401;
        throw error;
      }

      personalToken.lastUsedAt = new Date();
      personalToken.save().catch(err => console.error("Failed to update lastUsedAt for key:", err));

      const user = await authService.findUserById(personalToken.user);
      if (!user) {
        const error = new Error("Invalid personal access token: user not found");
        error.statusCode = 401;
        throw error;
      }

      req.auth = {
        userId: user._id.toString(),
        email: user.email,
        sessionID: "personal-access-token",
        isMfaEnabled: false,
      };
      req.user = user;
      return next();
    }

    // Default to JWT authentication
    let payload;
    try {
      payload = jwtService.verifyAccessToken(token);
    } catch (verifyError) {
      const error = new Error("Invalid or expired access token");
      error.statusCode = 401;
      throw error;
    }

    // Verify session is active in database
    const session = await Session.findOne({ _id: payload.sessionID, active: true });
    if (!session) {
      const error = new Error("Session has been revoked or expired");
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
