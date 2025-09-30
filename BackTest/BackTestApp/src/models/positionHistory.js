const mongoose = require('mongoose');

// Define the PositionHistory schema
const PositionHistorySchema = new mongoose.Schema({
  positionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  strategyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Strategy' },
  symbol: { type: String, required: true },

  action: {
    type: String,
    enum: ['entry', 'avg_update', 'partial_exit', 'close'],
    required: true
  },

  tradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trade' },
  quantityChange: { type: Number, required: true }, // +ve for buy, -ve for sell
  totalQuantity: { type: Number, required: true },
  avgPrice: { type: Number, required: true },

  realizedPnL: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

// Create PositionHistory model
const PositionHistory = mongoose.model('PositionHistory', PositionHistorySchema);
module.exports = PositionHistory;
