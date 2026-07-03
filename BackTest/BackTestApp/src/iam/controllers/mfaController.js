import * as authService from "../services/authService.js";
import * as mfaService from "../services/mfaService.js";
import * as sessionService from "../services/sessionService.js";
import * as jwtService from "../utils/jwtService.js";

export async function setup(req, res, next) {
  try {
    const { user } = req;
    if (!user) {
      const error = new Error("Authentication required");
      error.statusCode = 401;
      throw error;
    }

    const result = await mfaService.generateMfaSetup(user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function verifySetup(req, res, next) {
  try {
    const { token } = req.body || {};
    const { user } = req;
    if (!user || !token) {
      const error = new Error("Authenticated user and token are required");
      error.statusCode = 400;
      throw error;
    }

    const result = await mfaService.verifyMfaSetup(user, token);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function loginVerify(req, res, next) {
  try {
    const { email, password, token } = req.body || {};
    if (!email || !password || !token) {
      const error = new Error("Email, password, and token are required");
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

    const verifiedUser = await mfaService.verifyLoginMfa(email, token);

    const initialRoleId = Array.isArray(verifiedUser.roles) && verifiedUser.roles.length > 0
      ? verifiedUser.roles[0]
      : null;
    if (!initialRoleId) {
      const error = new Error("User does not have an assigned role for session creation");
      error.statusCode = 403;
      throw error;
    }

    const session = await sessionService.createSession({
      user: verifiedUser,
      currentRoleId: initialRoleId,
    });

    const payload = {
      userId: verifiedUser._id.toString(),
      email: verifiedUser.email,
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

