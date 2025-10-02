import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  account_id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  user_id: { type: String, required: true },
  current_balance: { type: Number, required: true, default: 0 },
  description: { type: String },
  created_on: { type: Date, default: Date.now },
});

export default mongoose.model("Account", accountSchema);
