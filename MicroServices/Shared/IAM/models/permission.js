const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema({
  operation: {
    type: String,
    required: true,
    enum: ["read", "write"],
    trim: true,
  },
  entity: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
    trim: true,
  },
}, {
  timestamps: true,
});

permissionSchema.index({ operation: 1, entity: 1 }, { unique: true });

module.exports = mongoose.model("Permission", permissionSchema);
