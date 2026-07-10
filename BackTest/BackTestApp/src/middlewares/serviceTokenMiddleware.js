import { authenticate } from "./authMiddleware.js";

const SERVICE_TOKEN = process.env.BACKTEST_SERVICE_TOKEN;

export function authenticateOrServiceToken(req, res, next) {
  if (SERVICE_TOKEN) {
    const headerToken = req.headers["x-service-token"];
    if (headerToken === SERVICE_TOKEN) {
      req.serviceAuth = true;
      return next();
    }
  }
  return authenticate(req, res, next);
}
