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

    // --- FINAL FIX IS HERE ---
    const newWebflowItem = await webflow.items.create({
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

  const db = getFirestore();
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
    return res.status(403).json({ message: 'Forbidden: You do not own this cluster.' });
  }

  const form = new Formidable();
  form.parse(req, async (err, fields, files) => {
    const imageFile = files.image?.[0];
    if (!imageFile) { return res.status(400).json({ message: 'No image file uploaded.' }); }

    try {
      const assetMetadata = await webflow.createAssetMetadata({
          fileName: imageFile.originalFilename,
          contentType: imageFile.mimetype,
          size: imageFile.size,
          parentFolder: clusterId
      });
      const { uploadUrl, asset } = assetMetadata;
      const fileData = fs.readFileSync(imageFile.filepath);
      await webflow.uploadAsset(uploadUrl, fileData, imageFile.mimetype);

      const permanentImageUrl = asset.url;
      const fieldToUpdate = {
        logo: 'cluster-logo-url',
        banner: 'banner-image-url'
      }[type];
      
      if (!fieldToUpdate) { return res.status(400).json({ message: 'Invalid image type.' }); }

      const fieldsToUpdate = { [fieldToUpdate]: permanentImageUrl };

      // --- FINAL FIX IS HERE ---
      const updatedItem = await webflow.items.patch({
        collectionId: process.env.WEBFLOW_CLUSTER_COLLECTION_ID,
        itemId: clusterId,
        fields: fieldsToUpdate
      }, { live: true });

      res.status(200).json({
        message: 'Image uploaded successfully!',
        imageUrl: permanentImageUrl,
        updatedItem: updatedItem
      });

    } catch (error) {
      // We will simplify the error handling for the asset folder for now
      console.error('Error during Webflow asset upload:', error);
      res.status(500).json({ message: 'Server error during file upload.' });
    }
  });
});

module.entreprises = router;