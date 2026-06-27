import dotenv from "dotenv";

dotenv.config();

function getEnv(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return value;
}

export { getEnv };
export const MONGO_URI = getEnv("MONGO_URI", "mongodb://localhost:27017/iam");
export const PORT = Number(getEnv("PORT", "3000"));
export const APP_NAME = getEnv("APP_NAME", "MoneyMaker");
export const MFA_ISSUER = getEnv("MFA_ISSUER", getEnv("APP_NAME", "MoneyMaker"));
export const JWT_ACCESS_SECRET = getEnv("JWT_ACCESS_SECRET", "iam-access-secret");
export const JWT_REFRESH_SECRET = getEnv("JWT_REFRESH_SECRET", "iam-refresh-secret");
export const JWT_ACCESS_EXPIRES = getEnv("JWT_ACCESS_EXPIRES", "15m");
export const JWT_REFRESH_EXPIRES = getEnv("JWT_REFRESH_EXPIRES", "1d");
export const JWT_ISSUER = getEnv("JWT_ISSUER", "iam-service");
export const JWT_AUDIENCE = getEnv("JWT_AUDIENCE", "iam-clients");
