// index.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
// Import BOTH middleware functions from our auth file
const { verifyFirebaseToken, adminAuth } = require('./middleware/auth');

// Import our route handlers
const clusterRoutes = require('./routes/clusters');
const adminRoutes = require('./routes/admin');

const app = express();

// --- Global Middleware ---
app.use(cors());
app.use(express.json());


// --- Route Definitions ---

// 1. Public Health Check Route
app.get('/api', (req, res) => {
  res.status(200).json({ message: 'SCL Hub API is running!' });
});


// 2. Protected Admin Routes (Uses HTTP Basic Auth popup)
app.use('/api/admin', adminAuth, adminRoutes);


// 3. Protected User Routes (Requires Firebase Bearer Token)
app.use('/api/clusters', verifyFirebaseToken, clusterRoutes);


// Export the app for Vercel
module.exports = app;