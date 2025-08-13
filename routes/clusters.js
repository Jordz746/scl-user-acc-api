// routes/clusters.js

const express = require('express');
const webflow = require('../services/webflow');

const router = express.Router();

// --- TEMPORARY DIAGNOSTIC ROUTE ---
router.post('/', async (req, res) => {
  try {
    // We know authentication works. Now let's test the Webflow client.
    console.log("--- DIAGNOSTIC TEST: Attempting the simplest API call: webflow.sites.list() ---");
    
    // This is the most basic API call. If it succeeds, the client is working.
    const sites = await webflow.sites.list(); 
    
    console.log("--- DIAGNOSTIC SUCCESS ---");
    console.log("The Webflow client is ALIVE and successfully fetched data.");
    console.log("Sites found:", sites);

    // Send a success response. We are not creating a cluster in this test.
    res.status(200).json({
      message: "Diagnostic test successful. The Webflow client is working.",
      sites: sites,
    });

  } catch (error) {
    console.error("--- DIAGNOSTIC FAILED ---");
    console.error("The call to webflow.sites.list() failed. Error:", error.message);
    
    // This will show us what the webflow object actually contains if the call fails
    console.error("Structure of the webflow object:", webflow);

    res.status(500).json({
      message: "Diagnostic test failed. See Vercel logs for details.",
      error: error.message,
    });
  }
});

// We are disabling the image upload route for this test.
router.post('/:clusterId/image', async (req, res) => {
    res.status(501).json({ message: 'Image upload is disabled during diagnostic test.' });
});

module.exports = router;