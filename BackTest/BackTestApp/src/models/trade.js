import mongoose from "mongoose";

const tradeSchema = new mongoose.Schema({
  trade_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(), // Auto-generate
    unique: true,
  },
  instrument_token: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  strategy_id: { type: String },
  user_id: { type: String, required: true },
  account_id: { type: String, required: true },
  type_of_order: { type: String, enum: ["BUY", "SELL"], required: true },
  created_at: { type: Date, default: Date.now },
});

export default mongoose.model("Trade", tradeSchema);
