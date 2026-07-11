import mongoose from "mongoose";

const strategySchema = new mongoose.Schema({
  strategy_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  strategy_name: {
    type: String,
    required: true,
    trim: true,
  },
  strategy_description: {
    type: String,
  },
  target_pts: {
    type: Number,
    default: 500,
  },
  sl_pts: {
    type: Number,
    default: 500,
  },
  advance_trade_decision: {
    type: Boolean,
    default: false,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
strategySchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

// Indexes
strategySchema.index({ user_id: 1 });
strategySchema.index({ user_id: 1, is_active: 1 });

export default mongoose.model("Strategy", strategySchema);
