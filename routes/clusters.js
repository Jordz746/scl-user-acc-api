// routes/clusters.js

const express = require('express');
const webflow = require('../services/webflow');

const router = express.Router();

// --- THE FINAL DIAGNOSTIC ROUTE ---
router.post('/', async (req, res) => {
  try {
    console.log("--- FINAL DIAGNOSTIC: INSPECTING THE WEBLFOW CLIENT ---");
    
    // We will log the public keys of the webflow object and its nested properties.
    // This will show us the correct path to the 'create' function.
    
    const webflowKeys = Object.keys(webflow);
    console.log("Top-level keys on 'webflow' object:", webflowKeys);

    // Let's inspect the 'collections' property if it exists
    if (webflow.collections) {
      console.log("Keys on 'webflow.collections':", Object.keys(webflow.collections));
      
      // Let's inspect 'webflow.collections.items' if it exists
      if (webflow.collections.items) {
        console.log("Keys on 'webflow.collections.items':", Object.keys(webflow.collections.items));
      } else {
        console.log("'webflow.collections.items' is undefined.");
      }

    } else {
      console.log("'webflow.collections' is undefined.");
    }
    
    res.status(200).json({ 
      message: "Final diagnostic complete. Check Vercel logs for the client structure.",
    });

  } catch (error) {
    console.error("--- FINAL DIAGNOSTIC FAILED ---", error.message);
    res.status(500).json({
      message: "Final diagnostic failed.",
      error: error.message,
    });
  }
});

// Disable the other route for this test.
router.post('/:clusterId/image', async (req, res) => {
    res.status(501).json({ message: 'Disabled for diagnostic.' });
});

module.exports = router;