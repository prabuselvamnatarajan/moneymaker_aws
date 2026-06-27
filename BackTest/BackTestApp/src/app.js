import express from "express";
import bodyParser from "body-parser";
import tradeRoutes from "./routes/tradeRoute.js";
import userRoutes from "./routes/userRoute.js";
import accountRoutes from "./routes/accountRoute.js";
import strategyRoutes from "./routes/strategyRoute.js";
import deploymentRoutes from "./routes/deploymentRoute.js";
import authRoutes from "./routes/authRoute.js";

const app = express();

app.use(bodyParser.json());
app.use("/api", tradeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/strategies", strategyRoutes);
app.use("/api/deployments", deploymentRoutes);

export default app;
