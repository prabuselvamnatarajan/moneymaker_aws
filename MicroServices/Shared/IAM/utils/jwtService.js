const jwt = require("jsonwebtoken");
const config = require("../config");

function signAccessToken(payload) {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
