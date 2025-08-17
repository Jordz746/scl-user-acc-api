// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const fetch = require('node-fetch'); // We may need to install this
const { Formidable } = require('formidable');
const fs = require('fs');
const md5File = require('md5-file');
const FormData = require('form-data');

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

    // Security checks...
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
        return res.status(403).json({ message: 'Forbidden: You do not own this cluster.' });
    }

    const form = new Formidable();
    form.parse(req, async (err, fields, files) => {
        if (err) { return res.status(500).json({ message: 'Error parsing form' }); }
        const imageFile = files.image?.[0];
        if (!imageFile) { return res.status(400).json({ message: 'No image file uploaded' }); }

        try {
            // --- STEP A: REGISTER THE ASSET WITH WEBFLOW ---
            const fileHash = await md5File(imageFile.filepath);
            console.log(`Step A: Registering asset with fileName: ${imageFile.originalFilename} and hash: ${fileHash}`);

            const registerResponse = await fetch(`https://api.webflow.com/v2/sites/${siteId}/assets`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    fileName: imageFile.originalFilename,
                    fileHash: fileHash
                })
            });

            const assetData = await registerResponse.json();

            // Handle the 'duplicate_file' case - this is a success!
            if (assetData.code === 'duplicate_file') {
                console.log("File is a duplicate. Using existing asset.");
                // We will handle the CMS update with the existing URL later. This is a success for the upload.
            } else if (!registerResponse.ok) {
                console.error("Webflow API Error (Step A):", assetData);
                throw new Error(assetData.message || 'Failed to register asset with Webflow.');
            } else {
                // --- STEP B: UPLOAD THE FILE TO THE PROVIDED URL ---
                console.log("Step B: Uploading file to the provided URL.");
                const uploadUrl = assetData.uploadUrl;
                const fileStream = fs.createReadStream(imageFile.filepath);

                const formData = new FormData();
                // Append all the required fields from the Webflow response
                Object.keys(assetData.fields).forEach(key => {
                    formData.append(key, assetData.fields[key]);
                });
                // Append the actual file data
                formData.append('file', fileStream);

                const uploadResponse = await fetch(uploadUrl, {
                    method: 'POST',
                    body: formData,
                    headers: formData.getHeaders()
                });

                // A 204 response is a success for this S3 upload
                if (uploadResponse.status !== 204) {
                    throw new Error(`File upload failed with status: ${uploadResponse.status}`);
                }
                console.log("Step B: File upload successful.");
            }
            
            // --- STEP C: UPDATE THE CMS ITEM ---
            const permanentImageUrl = assetData.url;
            console.log(`Step C: Updating CMS with permanent URL: ${permanentImageUrl}`);
            // ... (The CMS update logic from before is correct and will be added back here) ...
            
            res.status(200).json({
                message: "Image uploaded and processed successfully!",
                imageUrl: permanentImageUrl,
            });

        } catch (error) {
            console.error('Error during image upload process:', error.message);
            res.status(500).json({ message: 'Server error during image upload.', error: error.message });
        }
    });
});


module.exports = router;