const PositionHistoryService = require('../services/positionHistoryService');

exports.createPositionHistory = async (req, res) => {
  try {
    const { positionId, userId, action, quantityChange, avgPrice, realizedPnL } = req.body;
    const positionHistory = await PositionHistoryService.create({
      positionId, userId, action, quantityChange, avgPrice, realizedPnL
    });
    res.status(201).json(positionHistory);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating position history' });
  }
};
