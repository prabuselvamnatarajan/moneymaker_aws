import mongoose from "mongoose";

const brokerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  is_internal: {
    type: Boolean,
    default: false,
  },
  user_id: {
    type: String,
    required: false,
  },
  credentials: {
    type: Object,
    default: {},
  },
  access_token: {
    type: String,
    default: "",
  },
  external_broker_id: {
    type: String,
    required: false,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Broker", brokerSchema);
