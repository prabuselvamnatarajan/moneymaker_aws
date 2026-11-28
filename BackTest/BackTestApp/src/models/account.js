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
    // Fixed for the life of the account: deployment modes are validated against it.
    immutable: true,
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
  broker_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Broker",
  },
});

// Update timestamp and validate broker on save
accountSchema.pre("save", async function (next) {
  this.updated_at = Date.now();
  if (this.account_type === "LIVE" && !this.broker_id) {
    return next(new Error("LIVE accounts must be linked to an external broker."));
  }
  if (this.broker_id) {
    try {
      const Broker = mongoose.model("Broker");
      const broker = await Broker.findById(this.broker_id);
      if (!broker) {
        return next(new Error("Associated broker not found"));
      }
      if (this.account_type !== "LIVE" && !broker.is_internal) {
        return next(new Error("Only LIVE accounts can be associated with external brokers. PAPER and SIMULATION accounts must use Cobra Trades broker."));
      }
      if (this.account_type === "LIVE" && broker.is_internal) {
        return next(new Error("LIVE accounts must be linked to an external broker."));
      }
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Indexes
accountSchema.index({ user_id: 1 });
accountSchema.index({ user_id: 1, is_active: 1 });

export default mongoose.model("Account", accountSchema);
