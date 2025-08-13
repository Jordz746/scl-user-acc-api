const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const webflow = require('../services/webflow');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const { clusterName, shortDescription, longDescription } = req.body;

    if (!clusterName || !shortDescription) {
      return res.status(400).json({ message: 'Cluster Name and Short Description are required.' });
    }

    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;
    
    // Using the v3.2.0 syntax which we now know works
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

// We can add the image upload logic back later.
router.post('/:clusterId/image', async (req, res) => {
    res.status(501).json({ message: 'Image upload not yet implemented.' });
});

module.exports = router;