import express from "express";
import bodyParser from "body-parser";
import tradeRoutes from "./routes/tradeRoute.js";

const app = express();

app.use(bodyParser.json());
app.use("/api", tradeRoutes);

export default app;
