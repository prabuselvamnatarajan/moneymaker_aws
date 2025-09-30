const Position = require('../models/position');

// Create a new position
exports.createPosition = async ({ userId, strategyId, symbol, quantity, avgPrice }) => {
  const position = new Position({
    userId,
    strategyId,
    symbol,
    quantity,
    avgPrice
  });

  await position.save();
  return position;
};

// Add more methods for closing, updating positions, etc., as needed
