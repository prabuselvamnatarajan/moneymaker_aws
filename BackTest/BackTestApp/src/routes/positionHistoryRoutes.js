const express = require('express');
const positionHistoryController = require('../controllers/positionHistoryController');

const router = express.Router();

// Route to create a new position history entry
router.post('/position-history', positionHistoryController.createPositionHistory);

module.exports = router;
