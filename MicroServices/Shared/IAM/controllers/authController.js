const authService = require("../services/authService");
const jwtService = require("../utils/jwtService");

async function signup(req, res, next) {
  try {
    const { email, name, password } = req.body || {};
    if (!email || !name || !password) {
      const error = new Error("Email, name, and password are required");
      error.statusCode = 400;
      throw error;
    }

    await authService.createUser({ email, name, password });
    res.status(201).json({ message: "Sign Up success!" });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
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

    const payload = { userId: user._id.toString(), email: user.email };
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

module.exports = {
  signup,
  login,
};
