import mongoose from "mongoose";

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
    trim: true,
  },
  permissions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Permission",
  }],
  active: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

roleSchema.index({ name: 1 });

export default mongoose.model("Role", roleSchema);
