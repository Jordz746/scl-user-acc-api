// services/webflow.js

const { WebflowClient } = require('webflow-api');

// This is the correct initialization for v3.x
const webflow = new WebflowClient({
  accessToken: process.env.WEBFLOW_API_TOKEN,
});

module.exports = webflow;