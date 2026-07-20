import { authenticate } from "./authMiddleware.js";

const SERVICE_TOKEN = process.env.BACKTEST_SERVICE_TOKEN;

export function authenticateOrServiceToken(req, res, next) {
  if (SERVICE_TOKEN) {
    const headerToken = req.headers["x-service-token"];
    if (headerToken === SERVICE_TOKEN) {
      req.serviceAuth = true;
      const userId = req.headers["x-user-id"] || "6a5d8adf2b4e26938bc372fe";
      req.auth = { userId };
      return next();
    }
  }
  return authenticate(req, res, next);
}

/** Require X-Service-Token only (no JWT fallback). For privileged internal mutations. */
export function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    return res.status(503).json({ message: "Service token auth is not configured" });
  }
  const headerToken = req.headers["x-service-token"];
  if (headerToken === SERVICE_TOKEN) {
    req.serviceAuth = true;
    return next();
  }
  return res.status(403).json({ message: "Valid X-Service-Token required" });
}
