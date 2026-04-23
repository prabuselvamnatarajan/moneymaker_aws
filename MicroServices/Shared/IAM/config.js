const dotenv = require("dotenv");

dotenv.config();

function getEnv(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return value;
}

module.exports = {
  getEnv,
  MONGO_URI: getEnv("MONGO_URI", "mongodb://localhost:27017/iam"),
  PORT: Number(getEnv("PORT", "3000")),

  APP_NAME: getEnv("APP_NAME", "MoneyMaker"),
  MFA_ISSUER: getEnv("MFA_ISSUER", getEnv("APP_NAME", "MoneyMaker")),
  JWT_ACCESS_SECRET: getEnv("JWT_ACCESS_SECRET", "iam-access-secret"),
  JWT_REFRESH_SECRET: getEnv("JWT_REFRESH_SECRET", "iam-refresh-secret"),
  JWT_ACCESS_EXPIRES: getEnv("JWT_ACCESS_EXPIRES", "15m"),
  JWT_REFRESH_EXPIRES: getEnv("JWT_REFRESH_EXPIRES", "1d"),
  JWT_ISSUER: getEnv("JWT_ISSUER", "iam-service"),
  JWT_AUDIENCE: getEnv("JWT_AUDIENCE", "iam-clients"),
};
