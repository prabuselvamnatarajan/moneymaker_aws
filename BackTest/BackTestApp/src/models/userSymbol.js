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
  },
  symbol_name: {
    type: String,
    required: true,
  },
  exchange: {
    type: String,
    enum: ["NSE", "BSE", "NFO"],
    default: "NSE",
  },
  description: {
    type: String,
    default: "",
  },
  instrument_class: {
    type: String,
    default: "EQUITY",
  },
  /** Strike grid step for INDEX underlyings (e.g. 50 for Nifty, 100 for Bank Nifty). */
  strike_price_diff: {
    type: Number,
    default: null,
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

userSymbolSchema.pre("validate", function (next) {
  const cls = String(this.instrument_class || "").toUpperCase();
  if (cls === "INDEX") {
    if (this.strike_price_diff == null || !(Number(this.strike_price_diff) > 0)) {
      return next(new Error("strike_price_diff is required for INDEX symbols and must be > 0"));
    }
  }
  next();
});

// Compound unique indexes
userSymbolSchema.index({ user_id: 1, instrument_token: 1 }, { unique: true });
userSymbolSchema.index({ user_id: 1 });
userSymbolSchema.index({ user_id: 1, is_active: 1 });

export default mongoose.model("UserSymbol", userSymbolSchema);
