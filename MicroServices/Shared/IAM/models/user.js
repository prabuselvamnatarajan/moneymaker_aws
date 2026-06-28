import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, sparse: true, trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  is_mfa_enabled: { type: Boolean, default: false },
  is_active: { type: Boolean, default: true },
  mfa_secret: { type: String, default: "" },
  mfa_temp_secret: { type: String, default: "" },
  backup_codes: { type: [String], default: [] },
  roles: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],
    default: [],
  },
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ roles: 1 });

export default mongoose.model("User", userSchema);
