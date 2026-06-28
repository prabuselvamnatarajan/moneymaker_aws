import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  getAllLedgerController,
  getLedgerByIdController
} from "../controllers/ledger.js";

const router = express.Router();

router.get("/", authenticate, getAllLedgerController);
router.get("/:id", authenticate, getLedgerByIdController);

export default router;
