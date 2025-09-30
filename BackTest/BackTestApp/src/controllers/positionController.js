const PositionService = require('../services/positionService');

exports.createPosition = async (req, res) => {
  try {
    const { userId, strategyId, symbol, quantity, avgPrice } = req.body;
    const position = await PositionService.createPosition({ userId, strategyId, symbol, quantity, avgPrice });
    res.status(201).json(position);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating position' });
  }
};
