import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  getAllLedgerController,
  getLedgerByIdController,
  depositController,
  withdrawController,
  transferController
} from "../controllers/ledger.js";

const router = express.Router();

router.get("/", authenticate, getAllLedgerController);
router.post("/deposit", authenticate, depositController);
router.post("/withdraw", authenticate, withdrawController);
router.post("/transfer", authenticate, transferController);
router.get("/:id", authenticate, getLedgerByIdController);

export default router;
