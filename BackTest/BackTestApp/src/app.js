import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";

// Route imports
import tradeRoutes from "./routes/tradeRoute.js";
import userRoutes from "./routes/userRoute.js";
import accountRoutes from "./routes/accountRoute.js";
import strategyRoutes from "./routes/strategyRoute.js";
import deploymentRoutes from "./routes/deploymentRoute.js";
import positionRoutes from "./routes/positionRoute.js";
import authRoutes from "./routes/authRoute.js";
import meRoutes from "./routes/meRoute.js";
import symbolRoutes from "./routes/symbolRoute.js";
import ledgerRoutes from "./routes/ledgerRoute.js";
import adminRoutes from "./routes/adminRoute.js";
import brokerRoutes from "./routes/brokerRoute.js";
import externalBrokerRoutes from "./routes/externalBrokerRoute.js";
import volumeRoutes from "./routes/volumeRoute.js";
import dockerRoutes from "./routes/dockerRoute.js";

let isReady = false;

export const setAppReady = (ready = true) => {
  isReady = Boolean(ready);
};

export const getAppReady = () => isReady;

const app = express();
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  // Do not allow X-Service-Token via CORS — service auth is server-to-server only
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(bodyParser.json({ limit: "500mb" }));
app.use(bodyParser.urlencoded({ limit: "500mb", extended: true }));

// Health check
app.get("/health", (req, res) => {
  const dbConnected = mongoose.connection && mongoose.connection.readyState === 1;
  if (!isReady && !dbConnected) {
    return res.status(503).json({
      status: "initializing",
      db: "connecting",
      timestamp: new Date().toISOString(),
    });
  }
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Guard API routes while database/services are initializing
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const dbConnected = mongoose.connection && mongoose.connection.readyState === 1;
  if (!isReady && !dbConnected) {
    return res.status(503).json({
      message: "BacktestApp is initializing dependencies, please try again shortly",
      status: "initializing",
    });
  }
  next();
});

// --- Mount routes at root level (REST API Design Plan) ---
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/users", userRoutes);
app.use("/accounts", accountRoutes);
app.use("/strategies", strategyRoutes);
app.use("/deployments", deploymentRoutes);
app.use("/trades", tradeRoutes);
app.use("/positions", positionRoutes);
app.use("/symbols", symbolRoutes);
app.use("/ledger", ledgerRoutes);
app.use("/admin", adminRoutes);
app.use("/brokers", brokerRoutes);
app.use("/external-brokers", externalBrokerRoutes);
app.use("/volumes", volumeRoutes);
app.use("/docker", dockerRoutes);

// --- Mount routes at /api prefix (backward compatibility) ---
app.use("/api", tradeRoutes);          // legacy /api/trade endpoint
app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/users", userRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/strategies", strategyRoutes);
app.use("/api/deployments", deploymentRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/positions", positionRoutes);
app.use("/api/symbols", symbolRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/brokers", brokerRoutes);
app.use("/api/external-brokers", externalBrokerRoutes);
app.use("/api/volumes", volumeRoutes);
app.use("/api/docker", dockerRoutes);

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

export default app;
