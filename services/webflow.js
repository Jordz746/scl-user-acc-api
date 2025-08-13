const Webflow = require('webflow-api');

// This is the correct way to initialize the client.
// We import the default export, and then instantiate it with `new`.
const webflow = new Webflow({ token: process.env.WEBFLOW_API_TOKEN });

module.exports = webflow;