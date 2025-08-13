const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable');
const fs = require('fs');

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
    const fields = {
      'name': clusterName,
      'short-description': shortDescription,
      'long-description': longDescription,
      '_archived': false,
      '_draft': false 
    };
    
    // --- FIX IS HERE ---
    const newWebflowItem = await webflow.collections.createItem({
      collectionId: collectionId,
      fields: fields
    }, { live: true });

    const newClusterId = newWebflowItem.id;
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
    if (error.response && error.response.data) {
        console.error('Webflow API Error:', error.response.data);
    }
    res.status(500).json({ message: 'Server error while creating cluster.' });
  }
});

router.post('/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query;
    const { uid } = req.user;

    // ... (security checks stay the same) ...

    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
        return res.status(403).json({ message: 'Forbidden: You do not own this cluster.' });
    }

    const form = new Formidable();
    form.parse(req, async (err, fields, files) => {
        // ... (form parsing logic stays the same) ...
        const imageFile = files.image?.[0];
        if (!imageFile) { /* ... */ }

        try {
            // ... (asset upload logic stays the same) ...
            const assetMetadata = await webflow.createAssetMetadata({ /* ... */ });
            const { uploadUrl, asset } = assetMetadata;
            const fileData = fs.readFileSync(imageFile.filepath);
            await webflow.uploadAsset(uploadUrl, fileData, imageFile.mimetype);

            const permanentImageUrl = asset.url;
            const fieldToUpdate = {
                logo: 'cluster-logo-url',
                banner: 'banner-image-url'
            }[type];

            if (!fieldToUpdate) { /* ... */ }

            const fieldsToUpdate = { [fieldToUpdate]: permanentImageUrl };
            
            // --- FIX IS HERE ---
            const updatedItem = await webflow.collections.patchItem({
                collectionId: process.env.WEBFLOW_CLUSTER_COLLECTION_ID,
                itemId: clusterId,
                fields: fieldsToUpdate
            }, { live: true });

            res.status(200).json({
                message: 'Image uploaded and cluster updated successfully!',
                imageUrl: permanentImageUrl,
                updatedItem: updatedItem
            });

        } catch (error) {
            // ... (error handling logic stays the same) ...
            console.error('Error during Webflow asset upload:', error);
            res.status(500).json({ message: 'Server error during file upload.' });
        }
    });
});

module.exports = router;