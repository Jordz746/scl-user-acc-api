// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const fetch = require('node-fetch'); // We may need to install this

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const { clusterName, shortDescription, longDescription } = req.body;

    if (!clusterName || !shortDescription) {
      return res.status(400).json({ message: 'Cluster Name and Short Description are required.' });
    }

    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;
    const apiToken = process.env.WEBFLOW_API_TOKEN;

    // --- DIRECT API CALL USING FETCH ---
    // This bypasses the broken SDK completely.
    
    // 1. Prepare the data payload.
    // IMPORTANT: The field slugs here MUST match your CMS collection.
    const payload = {
      isArchived: false,
      isDraft: false,
      fieldData: {
        'name': clusterName, // Webflow's required "Name" field
        'slug': clusterName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 255), // Webflow's required "Slug" field
        'cluster-name': clusterName,
        'cluster-short-description---max-100-characters': shortDescription,
        'cluster-description': longDescription,
        'firebase-uid': uid // Store the user's ID directly in the CMS item!
      }
    };
    
    console.log("--- Sending direct API request to Webflow ---");

    // 2. Make the authenticated request.
    const response = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const newWebflowItem = await response.json();

    // 3. Check for errors from Webflow's response.
    if (!response.ok) {
        console.error("Webflow API Error:", newWebflowItem);
        // Throw an error to be caught by the catch block
        throw new Error(newWebflowItem.message || 'Failed to create item in Webflow.');
    }
    
    console.log("--- Webflow item created successfully ---");

    const newClusterId = newWebflowItem.id;
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    await userRef.set({ clusters: FieldValue.arrayUnion(newClusterId) }, { merge: true });

    res.status(201).json({
      message: 'Cluster created successfully!',
      clusterId: newClusterId,
      data: newWebflowItem
    });

  } catch (error) {
    console.error('Error creating cluster:', error.message);
    res.status(500).json({ message: 'Server error while creating cluster.', error: error.message });
  }
});

// Disable image uploads for now
router.post('/:clusterId/image', async (req, res) => {
    res.status(501).json({ message: 'Image upload not yet implemented.' });
});

module.exports = router;