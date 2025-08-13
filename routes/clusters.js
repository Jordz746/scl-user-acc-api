// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const webflow = require('../services/webflow');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const { clusterName, shortDescription, longDescription } = req.body;

    if (!clusterName) {
      return res.status(400).json({ message: 'Cluster Name is required.' });
    }

    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;
    
    // This is the correct syntax for the LATEST Webflow SDK
    const newWebflowItem = await webflow.collections.items.create(
      collectionId, 
      {
        isArchived: false,
        isDraft: false,
        fieldData: {
          'name': clusterName,
          'short-description': shortDescription,
          'long-description': longDescription
        }
      }
    );

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

router.post('/:clusterId/image', async (req, res) => {
    res.status(501).json({ message: 'Image upload not yet implemented.' });
});

module.exports = router;