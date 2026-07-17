import mongoose from "mongoose";

const positionSchema = new mongoose.Schema({
  position_id: {
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
  },
  account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true,
  },
  user_symbol_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserSymbol",
  },
  instrument_token: {
    type: String,
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true,
  },
  strategy_mode: {
    type: String,
    enum: ["LIVE", "PAPER", "BACKTEST"],
  },
  direction: {
    type: String,
    enum: ["LONG", "SHORT"],
    required: true,
  },
  status: {
    type: String,
    enum: ["OPEN", "CLOSED"],
    default: "OPEN",
  },
  total_size: {
    type: Number,
    default: 0,
  },
  open_size: {
    type: Number,
    default: 0,
  },
  average_entry_price: {
    type: Number,
    default: 0,
  },
  buy_price: {
    type: Number,
    default: 0,
  },
  sell_price: {
    type: Number,
    default: 0,
  },
  buy_qty: {
    type: Number,
    default: 0,
  },
  sell_qty: {
    type: Number,
    default: 0,
  },
  realised_pnl: {
    type: Number,
    default: 0,
  },
  unrealised_pnl: {
    type: Number,
    default: 0,
  },
  max_up: {
    type: Number,
    default: 0,
  },
  max_down: {
    type: Number,
    default: 0,
  },
  max_up_pct: {
    type: Number,
    default: 0,
  },
  max_down_pct: {
    type: Number,
    default: 0,
  },
  commission_total: {
    type: Number,
    default: 0,
  },
  trades: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trade",
    },
  ],
  opened_at: {
    type: Date,
    default: Date.now,
  },
  closed_at: {
    type: Date,
    default: null,
  },
  last_ltp: {
    type: Number,
    default: 0,
  },
});

positionSchema.index({ deployment_id: 1, status: 1 });
positionSchema.index({ deployment_id: 1, opened_at: 1 });
positionSchema.index({ user_id: 1, opened_at: -1 });
positionSchema.index({ symbol: 1, status: 1 });

export default mongoose.model("Position", positionSchema);
