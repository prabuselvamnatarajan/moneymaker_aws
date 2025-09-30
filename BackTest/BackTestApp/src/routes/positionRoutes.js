const express = require('express');
const positionController = require('../controllers/positionController');

const router = express.Router();

// Route to create a new position
router.post('/positions', positionController.createPosition);

module.exports = router;
