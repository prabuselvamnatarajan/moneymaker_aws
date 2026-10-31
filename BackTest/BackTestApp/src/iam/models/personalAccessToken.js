import mongoose from "mongoose";

const personalAccessTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  tokenPrefix: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  lastUsedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

personalAccessTokenSchema.index({ user: 1 });

export default mongoose.model("PersonalAccessToken", personalAccessTokenSchema);
