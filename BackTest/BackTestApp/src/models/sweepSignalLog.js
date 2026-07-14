import mongoose from "mongoose";

const sweepSignalLogSchema = new mongoose.Schema({
  deployment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deployment",
    required: true,
    index: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  symbol: {
    type: String,
    trim: true,
  },
  eventType: {
    type: String,
    enum: ["sweep", "trade"],
    default: "sweep",
  },
  outcome: {
    type: String,
    required: true,
    index: true,
  },
  level: Number,
  levelType: String,
  direction: String,
  sweepExtreme: Number,
  ltp: Number,
  tickCount: Number,
  eventType_detail: mongoose.Schema.Types.Mixed,
  params_snapshot: mongoose.Schema.Types.Mixed,
  timestamp: {
    type: Number,
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

sweepSignalLogSchema.index({ deployment_id: 1, created_at: -1 });
sweepSignalLogSchema.index({ deployment_id: 1, outcome: 1 });

export default mongoose.model("SweepSignalLog", sweepSignalLogSchema);
