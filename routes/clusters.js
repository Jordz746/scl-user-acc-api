// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable');
const fs = require('fs');
const md5File = require('md5-file');
const FormData = require('form-data');
const axios = require('axios'); // Our reliable HTTP client

const router = express.Router();

// --- CREATE A NEW CLUSTER (USING AXIOS) ---
router.post('/', async (req, res) => {
  try {
    const { uid } = req.user;
    const {
      clusterName, shortDescription, longDescription, discordUsername,
      discordInviteLink, websiteLink, clusterLocation, game, gameVersion,
      gameType, gameMode, numberOfMaps, tribeSize, harvestRates,
      platformsPc, platformsXbox, platformsPlaystation, windows1011
    } = req.body;

    if (!clusterName) {
      return res.status(400).json({ message: 'Cluster Name is required.' });
    }

    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    
    const payload = {
      isArchived: false, isDraft: false,
      fieldData: {
        'name': clusterName,
        'slug': clusterName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 255),
        'firebase-uid': uid,
        'cluster-name': clusterName,
        'cluster-short-description---max-100-characters': shortDescription,
        'cluster-description': longDescription,
        'discord-username': discordUsername,
        'discord-invite-link': discordInviteLink,
        'website-link-optional': websiteLink,
        'cluster-location': clusterLocation,
        'game': game,
        'game-version': gameVersion,
        'game-type': gameType,
        'game-mode': gameMode,
        'number-of-maps': parseInt(numberOfMaps, 10),
        'tribe-size': tribeSize,
        'harvest-rates': harvestRates,
        'platforms-pc': platformsPc,
        'platforms-xbox': platformsXbox,
        'platforms-playstation': platformsPlaystation,
        'windows-10-11': windows1011
      }
    };
    
    const response = await axios.post(
        `https://api.webflow.com/v2/collections/${collectionId}/items`,
        payload,
        { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json", "accept-version": "1.0.0" } }
    );
    const newWebflowItem = response.data;

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
    console.error('Error creating cluster:', error.response ? error.response.data : error.message);
    res.status(500).json({ message: 'Server error while creating cluster.' });
  }
});


// --- UPLOAD AN IMAGE (WITH SUBFOLDER LOGIC) ---
router.post('/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query;
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;
    const parentAssetFolderId = process.env.WEBFLOW_PARENT_ASSET_FOLDER_ID;

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
            // STEP 1: Create a dedicated subfolder for this cluster
            let subfolderId = null;
            try {
                const folderResponse = await axios.post(
                    `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
                    { displayName: clusterId, parentFolder: parentAssetFolderId },
                    { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
                );
                subfolderId = folderResponse.data.id;
                console.log(`Step 1: Successfully created new subfolder with ID: ${subfolderId}`);
            } catch(folderError) {
                console.log("Could not create subfolder, it may already exist. Will fall back to parent folder.");
                subfolderId = parentAssetFolderId;
            }

            // STEP 2: Register the asset inside the target folder
            const fileHash = await md5File(imageFile.filepath);
            const registerResult = await axios.post(
                `https://api.webflow.com/v2/sites/${siteId}/assets`,
                { fileName: imageFile.originalFilename, fileHash: fileHash, parentFolder: subfolderId },
                { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
            );
            const assetData = registerResult.data;

            // STEP 3: Upload the file
            const uploadUrl = assetData.uploadUrl;
            const fileStream = fs.createReadStream(imageFile.filepath);
            const formData = new FormData();
            const uploadFields = assetData.uploadDetails || assetData.fields;
            Object.keys(uploadFields).forEach(key => {
                formData.append(key, uploadFields[key]);
            });
            formData.append('file', fileStream);
            const uploadResult = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
            if (uploadResult.status !== 201 && uploadResult.status !== 204) {
                throw new Error(`File upload failed with status: ${uploadResult.status}`);
            }

            // STEP 4: Update the CMS Item
            const permanentImageUrl = assetData.hostedUrl || assetData.url;
            const fieldToUpdate = {
                'logo-1-1': '1-1-cluster-logo-image-link',
                'banner-16-9': '16-9-banner-image-link',
                'banner-9-16': '9-16-banner-image-link'
            }[type];
            if (!fieldToUpdate) return res.status(400).json({ message: 'Invalid image type.' });
            
            const payload = { isDraft: false, isArchived: false, fieldData: { [fieldToUpdate]: permanentImageUrl } };
            const patchResult = await axios.patch(
                `https://api.webflow.com/v2/collections/${process.env.WEBFLOW_CLUSTER_COLLECTION_ID}/items/${clusterId}`,
                payload,
                { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json", "accept-version": "1.0.0" } }
            );

            res.status(200).json({
                message: "Image uploaded and cluster updated successfully!",
                imageUrl: permanentImageUrl,
                updatedItem: patchResult.data
            });

        } catch (error) {
            console.error('Error during image upload process:', error.response ? error.response.data : error.message);
            res.status(500).json({ message: 'Server error during image upload.' });
        }
    });
});

router.get('/:clusterId', async (req, res) => {
    const { clusterId } = req.params;
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        // Step 1: Security check - Verify this user actually owns this cluster.
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to view this cluster.' });
        }

        // Step 2: Fetch the item from Webflow using its ID.
        const response = await axios.get(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            { headers: { "Authorization": `Bearer ${apiToken}`, "accept-version": "1.0.0" } }
        );

        res.status(200).json(response.data);

    } catch (error) {
        console.error(`Error fetching cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while fetching cluster data.' });
    }
});


// The IMAGE UPLOAD route is correct and stays the same.
router.post('/:clusterId/image', async (req, res) => { /* ... your working image upload logic ... */ });

module.exports = router;