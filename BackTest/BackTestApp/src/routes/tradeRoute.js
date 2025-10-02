import express from "express";
import { createTradeController } from "../controllers/trade.js";

const router = express.Router();

router.post("/trade", createTradeController);

export default router;
