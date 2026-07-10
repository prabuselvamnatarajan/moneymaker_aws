import * as authService from "../services/authService.js";
import * as jwtService from "../utils/jwtService.js";
import * as sessionService from "../services/sessionService.js";
import { parseUserAgent } from "../utils/userAgentParser.js";

export async function signup(req, res, next) {
  try {
    const { username, name, email, password } = req.body || {};
    if (!email || !password || !username || !name) {
      const error = new Error("Email, username, name, and password are required");
      error.statusCode = 400;
      throw error;
    }

    await authService.createUser({ username, name, email, password });
    res.status(201).json({ message: "Sign Up success!" });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      const error = new Error("Email and password are required");
      error.statusCode = 400;
      throw error;
    }

    const user = await authService.findUserByEmail(email);
    if (!user) {
      const error = new Error("Invalid email or password");
      error.statusCode = 401;
      throw error;
    }

    const passwordMatches = await authService.validatePassword(password, user.password);
    if (!passwordMatches) {
      const error = new Error("Invalid email or password");
      error.statusCode = 401;
      throw error;
    }

    if (user.is_mfa_enabled) {
      return res.status(200).json({
        message: "MFA required",
        mfaRequired: true,
      });
    }

    const initialRoleId = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles[0] : null;
    if (!initialRoleId) {
      const error = new Error("User does not have an assigned role for session creation");
      error.statusCode = 403;
      throw error;
    }

    const ua = req.headers["user-agent"] || "";
    const ip = req.headers["x-forwarded-for"] || req.ip || "127.0.0.1";
    const parsedUa = parseUserAgent(ua, ip);

    const session = await sessionService.createSession({
      user,
      currentRoleId: initialRoleId,
      ...parsedUa,
    });

    const payload = {
      userId: user._id.toString(),
      email: user.email,
      sessionID: session._id.toString(),
    };
    const accessToken = jwtService.signAccessToken(payload);
    const refreshToken = jwtService.signRefreshToken(payload);

    res.status(200).json({
      message: "Login success!",
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
}
