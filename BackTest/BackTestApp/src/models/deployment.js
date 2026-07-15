import mongoose from "mongoose";

const deploymentSchema = new mongoose.Schema({
  deployment_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
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
  },
  start_time: {
    type: Date,
    required: true,
  },
  end_time: {
    type: Date,
    default: null,
  },
  current_status: {
    type: String,
    enum: ["SCHEDULED", "RUNNING", "PAUSED", "STOPPED", "COMPLETED"],
    required: true,
  },
  strategy_mode: {
    type: String,
    enum: ["LIVE", "PAPER", "BACKTEST"],
    required: true,
  },
  deployment_name: {
    type: String,
  },
  notes: {
    type: String,
  },
  backtest_date: {
    type: String,
  },
  backtest_speed: {
    type: Number,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
  position_size: {
    type: Number,
    default: 0,
  },
  average_entry_price: {
    type: Number,
    default: 0,
  },
  use_full_amount: {
    type: Boolean,
    default: false,
  },
  backtest_run_id: {
    type: String,
  },
});

// Update timestamp on save
deploymentSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

// Validate end_time is after start_time
deploymentSchema.pre("save", function (next) {
  if (this.end_time && this.start_time >= this.end_time) {
    next(new Error("end_time must be after start_time"));
  } else {
    next();
  }
});

// Indexes
deploymentSchema.index({ user_id: 1 });
deploymentSchema.index({ user_id: 1, current_status: 1 });
deploymentSchema.index({ strategy_id: 1 });
deploymentSchema.index({ account_id: 1 });
deploymentSchema.index({ current_status: 1 });
// Unique constraint: only one active deployment per (strategy, account, symbol)
deploymentSchema.index(
  { strategy_id: 1, account_id: 1, instrument_token: 1, current_status: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { current_status: { $in: ["RUNNING", "SCHEDULED"] } },
  }
);

export default mongoose.model("Deployment", deploymentSchema);
