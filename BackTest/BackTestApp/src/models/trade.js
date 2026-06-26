import mongoose from "mongoose";

const tradeSchema = new mongoose.Schema({
  trade_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
  },
  deployment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deployment",
    required: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  strategy_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Strategy",
    required: true,
  },
  account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true,
  },
  user_symbol_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserSymbol",
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
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  type_of_order: {
    type: String,
    enum: ["BUY", "SELL"],
    required: true,
  },
  status: {
    type: String,
    enum: ["PENDING", "EXECUTED", "PARTIALLY_FILLED", "CANCELLED"],
    default: "EXECUTED",
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  execution_time: {
    type: Date,
    default: null,
  },
});

// Indexes
tradeSchema.index({ deployment_id: 1 });
tradeSchema.index({ account_id: 1 });
tradeSchema.index({ user_symbol_id: 1 });
tradeSchema.index({ user_id: 1 });
tradeSchema.index({ created_at: 1 });
tradeSchema.index({ deployment_id: 1, created_at: 1 });

export default mongoose.model("Trade", tradeSchema);
