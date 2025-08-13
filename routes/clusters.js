const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable');
const fs =require('fs');

const webflow = require('../services/webflow'); // This is the v1.x client

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const { clusterName, shortDescription, longDescription } = req.body;

    if (!clusterName || !shortDescription) {
      return res.status(400).json({ message: 'Cluster Name and Short Description are required.' });
    }
    
    // --- FINAL FIX IS HERE: Using the v1.x SDK syntax ---
    // Note: The `live` parameter is passed as part of the main object.
    const newWebflowItem = await webflow.createItem({
    collectionId: process.env.WEBFLOW_CLUSTER_COLLECTION_ID,
    live: true, // v1 SDK style
    fields: {
        'name': clusterName,
        'short-description': shortDescription,
        'long-description': longDescription,
        '_archived': false,
        '_draft': false
      }
    });

    const newClusterId = newWebflowItem._id; // In v1, the ID is `_id`
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);

    await userRef.set({
      clusters: FieldValue.arrayUnion(newClusterId)
    }, { merge: true });

    res.status(201).json({
      message: 'Cluster created successfully!',
      clusterId: newClusterId,
      data: newWebflowItem
    });

  } catch (error) {
    console.error('Error creating cluster:', error);
    // v1 errors might be different, logging the whole thing is safer
    res.status(500).json({ 
        message: 'Server error while creating cluster.',
        error: error 
    });
  }
});

router.post('/:clusterId/image', async (req, res) => {
    // We will leave the image upload for a follow-up, as its syntax will also be different.
    // Let's get cluster creation working first.
    res.status(501).json({ message: 'Image upload not yet implemented for v1 SDK.' });
});

module.exports = router;