const PositionHistory = require('../models/positionHistory');
const Position = require('../models/position');

// Create a position history entry
exports.create = async ({ positionId, userId, action, quantityChange, avgPrice, realizedPnL }) => {
  // Fetch position to check if it's valid
  const position = await Position.findById(positionId);
  if (!position) throw new Error('Position not found');

  // Calculate new position details
  const newPositionHistory = new PositionHistory({
    positionId,
    userId,
    action,
    quantityChange,
    totalQuantity: position.quantity + quantityChange, // Update logic based on the action
    avgPrice,
    realizedPnL,
    timestamp: new Date()
  });

  // Save the new position history entry
  await newPositionHistory.save();
  
  // Optionally update the position after each action (if needed)
  position.quantity += quantityChange;
  position.avgPrice = avgPrice;  // Recalculate average price
  await position.save();

  return newPositionHistory;
};
