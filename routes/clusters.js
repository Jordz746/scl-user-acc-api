// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable');
const fs = require('fs');

const webflow = require('../services/webflow');

const router = express.Router();

// CREATE A NEW CLUSTER
router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const { clusterName, shortDescription, longDescription } = req.body;

    if (!clusterName || !shortDescription) {
      return res.status(400).json({ message: 'Cluster Name and Short Description are required.' });
    }

    // --- v3.2.0 Syntax ---
    const newWebflowItem = await webflow.collections.items.create(
      process.env.WEBFLOW_CLUSTER_COLLECTION_ID, 
      {
        isArchived: false,
        isDraft: false,
        fieldData: {
          'name': clusterName,
          'short-description': shortDescription,
          'long-description': longDescription,
        }
      }
    );

    const newClusterId = newWebflowItem.id; // v3 uses 'id'
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    await userRef.set({ clusters: FieldValue.arrayUnion(newClusterId) }, { merge: true });

    res.status(201).json({
      message: 'Cluster created successfully!',
      clusterId: newClusterId,
      data: newWebflowItem,
    });

  } catch (error) {
    console.error('Error creating cluster:', error.message);
    res.status(500).json({ message: 'Server error while creating cluster.', error: error.message });
  }
});

// UPLOAD AN IMAGE
router.post('/:clusterId/image', async (req, res) => {
    // ...
});


module.exports = router;