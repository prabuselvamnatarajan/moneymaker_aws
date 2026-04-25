const mongoose = require("mongoose");

const sessionHistorySchema = new mongoose.Schema({
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Role",
    required: true,
  },
  order: {
    type: Number,
    required: true,
  },
  session_start_time: {
    type: Date,
    required: true,
    default: Date.now,
  },
  session_end_time: {
    type: Date,
    default: null,
  },
});

const sessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  currentRole: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Role",
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
    default: null,
  },
  roleHistory: {
    type: [sessionHistorySchema],
    default: [],
  },
}, {
  timestamps: true,
});

sessionSchema.index({ user: 1, active: 1 });
sessionSchema.index({ currentRole: 1 });

module.exports = mongoose.model("Session", sessionSchema);
