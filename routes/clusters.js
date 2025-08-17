// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const fetch = require('node-fetch'); // We may need to install this
const { Formidable } = require('formidable');
const fs = require('fs');
const md5File = require('md5-file');
const router = express.Router();

// routes/clusters.js - The final version of the create route

router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    
    // 1. Destructure ALL the new fields from the request body
    const {
      clusterName, shortDescription, longDescription, discordUsername,
      discordInviteLink, websiteLink, clusterLocation, game, gameVersion,
      gameType, gameMode, numberOfMaps, tribeSize, harvestRates,
      platformsPc, platformsXbox, platformsPlaystation, windows1011
    } = req.body;

    // We can keep the validation simple for now
    if (!clusterName || !shortDescription) {
      return res.status(400).json({ message: 'Cluster Name and Short Description are required.' });
    }

    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;
    const apiToken = process.env.WEBFLOW_API_TOKEN;

    // 2. Build the complete fieldData payload with all the correct slugs
    const payload = {
      isArchived: false,
      isDraft: false, // Items will be published immediately
      fieldData: {
        'name': clusterName,
        'slug': clusterName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 255),
        'cluster-name': clusterName,
        'cluster-short-description---max-100-characters': shortDescription,
        'cluster-description': longDescription,
        'firebase-uid': uid,
        'discord-username': discordUsername,
        'discord-invite-link': discordInviteLink,
        'website-link-optional': websiteLink,
        'cluster-location': clusterLocation,
        'game': game,
        'game-version': gameVersion,
        'game-type': gameType,
        'game-mode': gameMode,
        'number-of-maps': parseInt(numberOfMaps, 10), // Ensure this is a number
        'tribe-size': tribeSize,
        'harvest-rates': harvestRates,
        'platforms-pc': platformsPc,
        'platforms-xbox': platformsXbox,
        'platforms-playstation': platformsPlaystation,
        'windows-10-11': windows1011
      }
    };

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
          if (!response.ok) {
        // This will log the detailed error response from Webflow
        console.error("--- Webflow API Validation Error ---");
        console.error("Status:", response.status, response.statusText);
        console.error("Body:", newWebflowItem);
        // We will pass the specific Webflow error message back to the frontend
        const errorMessage = newWebflowItem.message || 'Failed to create item in Webflow.';
        const errorDetails = newWebflowItem.details ? JSON.stringify(newWebflowItem.details) : '';
        throw new Error(`${errorMessage} ${errorDetails}`);
    }
    
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

// routes/clusters.js

// ... (The router.post('/', ...) function stays the same) ...

router.post('/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query; 
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;

    // ... (Security checks are correct and stay the same) ...

    const form = new Formidable();
    form.parse(req, async (err, fields, files) => {
        if (err) { return res.status(500).json({ message: 'Error parsing form' }); }
        const imageFile = files.image?.[0];
        if (!imageFile) { return res.status(400).json({ message: 'No image file uploaded' }); }

        try {
            // --- The Correct Node.js FormData Workflow ---
            
            // 1. Create a file stream from the temporarily uploaded file path
            const fileStream = fs.createReadStream(imageFile.filepath);

            // 2. Create a new FormData instance
            const formData = new FormData();
            
            // 3. Append the file stream with the correct syntax
            // The third argument is an object for metadata like the filename.
            formData.append('file', fileStream, {
                filename: imageFile.originalFilename,
                contentType: imageFile.mimetype,
            });

            console.log("Attempting direct asset upload with correct FormData syntax...");

            // 4. Make the request to Webflow
            const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/assets`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiToken}`,
                    ...formData.getHeaders() // The library correctly sets the 'Content-Type'
                },
                body: formData
            });

            const asset = await response.json();
            if (!response.ok) {
                console.error("Webflow API Error:", asset);
                throw new Error(asset.message || 'Failed to upload asset to Webflow.');
            }

            console.log("Asset uploaded successfully:", asset.url);
            
            // --- 5. Now, update the CMS item ---
            const permanentImageUrl = asset.url;
            const fieldToUpdate = {
                'logo-1-1': '1-1-cluster-logo-image-link',
                'banner-16-9': '16-9-banner-image-link',
                'banner-9-16': '9-16-banner-image-link'
            }[type];
            if (!fieldToUpdate) return res.status(400).json({ message: 'Invalid image type.' });
            
            const payload = {
                isArchived: false, isDraft: false,
                fieldData: { [fieldToUpdate]: permanentImageUrl }
            };

            const patchResponse = await fetch(`https://api.webflow.com/v2/collections/${process.env.WEBFLOW_CLUSTER_COLLECTION_ID}/items/${clusterId}`, {
                method: "PATCH",
                headers: { "Authorization": `Bearer ${apiToken}`, "accept": "application/json", "content-type": "application/json" },
                body: JSON.stringify(payload)
            });
            const updatedItem = await patchResponse.json();
            if (!patchResponse.ok) throw new Error('Failed to update CMS item with image URL.');


            res.status(200).json({
                message: "Image uploaded and cluster updated successfully!",
                imageUrl: asset.url,
                updatedItem: updatedItem
            });

        } catch (error) {
            console.error('Error during image upload process:', error.message);
            res.status(500).json({ message: 'Server error during image upload.', error: error.message });
        }
    });
});

module.exports = router;