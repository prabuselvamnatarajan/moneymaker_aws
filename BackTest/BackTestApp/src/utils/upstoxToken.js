import jwt from "jsonwebtoken";

const DEFAULT_REDIS_KEY = "redis_upstox_access_token";

export function getUpstoxRedisKey(userId = "") {
  return userId ? `${DEFAULT_REDIS_KEY}:${userId}` : DEFAULT_REDIS_KEY;
}

export function isUpstoxTokenExpired(token, skewSeconds = 60) {
  if (!token || typeof token !== "string") {
    return true;
  }

  try {
    const payload = jwt.decode(token);
    if (!payload || typeof payload !== "object" || !payload.exp) {
      return true;
    }

    return Date.now() / 1000 >= payload.exp - skewSeconds;
  } catch {
    return true;
  }
}

export function getUpstoxTokenStatus(token) {
  if (!token) {
    return "missing";
  }
  return isUpstoxTokenExpired(token) ? "expired" : "valid";
}
