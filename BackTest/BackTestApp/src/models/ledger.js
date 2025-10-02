import mongoose from "mongoose";

const ledgerSchema = new mongoose.Schema({
  ledger_id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  account_id: { type: String, required: true },
  trade_id: { type: String, required: true },
  change_in_balance: { type: Number, required: true },
  opening_balance: { type: Number, required: true },
  closing_balance: { type: Number, required: true },
  created_on: { type: Date, default: Date.now },
});

export default mongoose.model("Ledger", ledgerSchema);
