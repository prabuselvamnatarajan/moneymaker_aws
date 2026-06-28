import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  user_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please provide a valid email"],
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  is_mfa_enabled: {
    type: Boolean,
    default: false,
  },
  mfa_secret: {
    type: String,
    default: "",
  },
  mfa_temp_secret: {
    type: String,
    default: "",
  },
  backup_codes: {
    type: [String],
    default: [],
  },
  roles: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],
    default: [],
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
userSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

// Indexes
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ roles: 1 });

export default mongoose.model("User", userSchema);
