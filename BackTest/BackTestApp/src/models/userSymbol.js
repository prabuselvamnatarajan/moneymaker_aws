import mongoose from "mongoose";

const userSymbolSchema = new mongoose.Schema({
  user_symbol_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  instrument_token: {
    type: String,
    required: true,
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true,
  },
  exchange: {
    type: String,
    enum: ["NSE", "BSE", "NFO"],
    default: "NSE",
  },
  added_at: {
    type: Date,
    default: Date.now,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
});

// Compound unique indexes
userSymbolSchema.index({ user_id: 1, instrument_token: 1 }, { unique: true });
userSymbolSchema.index({ user_id: 1 });
userSymbolSchema.index({ user_id: 1, is_active: 1 });

export default mongoose.model("UserSymbol", userSymbolSchema);
