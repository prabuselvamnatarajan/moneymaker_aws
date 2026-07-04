import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  account_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  account_name: {
    type: String,
    required: true,
    trim: true,
  },
  account_type: {
    type: String,
    enum: ["LIVE", "PAPER", "SIMULATION"],
    required: true,
  },
  current_balance: {
    type: Number,
    required: true,
    default: 0,
  },
  initial_balance: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  commission_type: {
    type: String,
    enum: ["PERCENTAGE", "FLAT"],
    default: "PERCENTAGE",
  },
  commission_rate: {
    type: Number,
    default: 0,
  },
  created_on: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
accountSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

// Indexes
accountSchema.index({ user_id: 1 });
accountSchema.index({ user_id: 1, is_active: 1 });

export default mongoose.model("Account", accountSchema);
