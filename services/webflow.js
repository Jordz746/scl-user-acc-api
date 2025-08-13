const { WebflowClient } = require('webflow-api');

// Initialize the Webflow API client with the token from our environment variables
const webflow = new WebflowClient({ token: process.env.WEBFLOW_API_TOKEN });

module.exports = webflow;