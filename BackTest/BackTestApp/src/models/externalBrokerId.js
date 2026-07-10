import mongoose from "mongoose";

const externalBrokerIdSchema = new mongoose.Schema({
  external_broker_id: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  created_on: {
    type: Date,
    default: Date.now,
  },
  last_modified_on: {
    type: Date,
    default: Date.now,
  },
}, { collection: "external_broker_ids" });

externalBrokerIdSchema.pre("save", function (next) {
  this.last_modified_on = Date.now();
  next();
});

export default mongoose.model("ExternalBrokerId", externalBrokerIdSchema);
