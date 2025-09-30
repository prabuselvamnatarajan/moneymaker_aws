const express = require('express');
const connectDB = require('./utils/db');
const positionRoutes = require('./routes/positionRoutes');
const positionHistoryRoutes = require('./routes/positionHistoryRoutes');
const config = require('./config/config');

const app = express();

// Connect to MongoDB
connectDB();

// Middleware to parse JSON request bodies
app.use(express.json());

// API Routes
app.use('/api', positionRoutes);
app.use('/api', positionHistoryRoutes);

// Start the server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
