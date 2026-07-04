import express from "express";
import bodyParser from "body-parser";

// Route imports
import tradeRoutes from "./routes/tradeRoute.js";
import userRoutes from "./routes/userRoute.js";
import accountRoutes from "./routes/accountRoute.js";
import strategyRoutes from "./routes/strategyRoute.js";
import deploymentRoutes from "./routes/deploymentRoute.js";
import authRoutes from "./routes/authRoute.js";
import meRoutes from "./routes/meRoute.js";
import symbolRoutes from "./routes/symbolRoute.js";
import ledgerRoutes from "./routes/ledgerRoute.js";
import adminRoutes from "./routes/adminRoute.js";
import brokerRoutes from "./routes/brokerRoute.js";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(bodyParser.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- Mount routes at root level (REST API Design Plan) ---
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/users", userRoutes);
app.use("/accounts", accountRoutes);
app.use("/strategies", strategyRoutes);
app.use("/deployments", deploymentRoutes);
app.use("/trades", tradeRoutes);
app.use("/symbols", symbolRoutes);
app.use("/ledger", ledgerRoutes);
app.use("/admin", adminRoutes);
app.use("/brokers", brokerRoutes);

// --- Mount routes at /api prefix (backward compatibility) ---
app.use("/api", tradeRoutes);          // legacy /api/trade endpoint
app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/users", userRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/strategies", strategyRoutes);
app.use("/api/deployments", deploymentRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/symbols", symbolRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/brokers", brokerRoutes);

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
