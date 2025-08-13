require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { verifyFirebaseToken } = require('./middleware/auth');

// Import our new router
const clusterRoutes = require('./routes/clusters');

const app = express();

app.use(cors());
app.use(express.json());

// --- Public Route ---
app.get('/api', (req, res) => {
  res.status(200).json({ message: 'SCL Hub API is running!' });
});

// --- Protected Routes ---
// Any route starting with /api/clusters will first go through our verifyFirebaseToken middleware,
// then be handled by the logic in clusterRoutes.
app.use('/api/clusters', verifyFirebaseToken, clusterRoutes);


module.exports = app;

// --- Optional: For local development ---
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}