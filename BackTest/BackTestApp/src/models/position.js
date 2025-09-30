const mongoose = require('mongoose');

// Define the Position schema
const PositionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  strategyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Strategy' },
  symbol: { type: String, required: true },
  quantity: { type: Number, required: true },
  avgPrice: { type: Number, required: true },
  openTimestamp: { type: Date, default: Date.now },
  closedTimestamp: { type: Date, default: null }
});

// Create Position model
const Position = mongoose.model('Position', PositionSchema);
module.exports = Position;
