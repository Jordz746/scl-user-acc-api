const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable');
const fs = require('fs');

const webflow = require('../services/webflow');

const router = express.Router();

// --- TEMPORARY DEBUGGING ROUTE ---
// --- TEMPORARY DEBUGGING ROUTE ---
router.post('/', async (req, res) => {
  // We know the code gets here successfully.
  console.log("--- DEBUGGING WEBLFOW CLIENT ---");
  
  // Let's print the top-level keys available on the 'webflow' object.
  // This will show us if it has 'sites', 'collections', etc.
  console.log("Available keys on webflow client:", Object.keys(webflow));

  // Let's also log the collections object to see its methods.
  console.log("Contents of webflow.collections:", webflow.collections);
  
  // Send a temporary success response so the request doesn't time out.
  res.status(200).json({ 
    message: "Debug information has been logged to Vercel.",
    availableKeys: Object.keys(webflow)
  });
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

module.exports  = router;