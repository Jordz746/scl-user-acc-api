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
// --- UPLOAD AN IMAGE (WITH DELETE & SUBFOLDER LOGIC) ---
router.post('/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query; 
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;
    const parentAssetFolderId = process.env.WEBFLOW_PARENT_ASSET_FOLDER_ID;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    // Security check: Verify user ownership of the cluster
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

        // --- Backend File Validation ---
        const MAX_SIZE_MB = 3.5;
        if (imageFile.size > MAX_SIZE_MB * 1024 * 1024) {
            return res.status(400).json({ message: `File is too large. Maximum size is ${MAX_SIZE_MB}MB.` });
        }
        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
        if (!ALLOWED_TYPES.includes(imageFile.mimetype)) {
            return res.status(400).json({ message: 'Invalid file type. Only JPG, PNG, and WEBP are allowed.' });
        }

        try {
            // --- STEP 1: Get current CMS item to check for an existing image ---
            const itemResponse = await axios.get(
                `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
                { headers: { "Authorization": `Bearer ${apiToken}`, "accept-version": "1.0.0" } }
            );
            const currentItemData = itemResponse.data.fieldData;
            
            const fieldToUpdate = {
                'logo-1-1': '1-1-cluster-logo-image-link',
                'banner-16-9': '16-9-banner-image-link',
                'banner-9-16': '9-16-banner-image-link'
            }[type];
            if (!fieldToUpdate) return res.status(400).json({ message: 'Invalid image type.' });

            const existingImageUrl = currentItemData[fieldToUpdate];

           
            // --- STEP 2: If an image exists, find and delete its asset (Robust Version) ---
            if (existingImageUrl) {
                try {
                    // Extract the filename from the full URL
                    const existingFileName = existingImageUrl.split('/').pop();
                    console.log(`Step 2: Found existing image. Filename: ${existingFileName}. Attempting to delete asset.`);

                    const assetsResponse = await axios.get(
                        `https://api.webflow.com/v2/sites/${siteId}/assets`,
                        { headers: { "Authorization": `Bearer ${apiToken}` } }
                    );
                    
                    // THIS IS THE ROBUST COMPARISON
                    const assetToDelete = assetsResponse.data.assets.find(asset => asset.originalFileName === existingFileName);

                    if (assetToDelete) {
                        console.log(`Found matching asset to delete with ID: ${assetToDelete.id}`);
                        await axios.delete(
                            `https://api.webflow.com/v2/assets/${assetToDelete.id}`,
                            { headers: { "Authorization": `Bearer ${apiToken}` } }
                        );
                        console.log(`Successfully deleted existing asset.`);
                    } else {
                        console.log("Could not find a matching asset to delete by filename. Proceeding with upload.");
                    }
                } catch (deleteError) {
                    console.error("Could not delete existing asset, it might have been removed already. Proceeding.", deleteError.message);
                }
            }

            // --- STEP 3: "Get or Create" Subfolder ---
            let subfolderId = null;
            const listFoldersResponse = await axios.get(
                `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
                { headers: { "Authorization": `Bearer ${apiToken}` } }
            );
            const existingFolder = listFoldersResponse.data.assetFolders.find(f => f.displayName === clusterId);
            if (existingFolder) {
                subfolderId = existingFolder.id;
            } else {
                const createFolderResponse = await axios.post(
                    `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
                    { displayName: clusterId, parentFolder: parentAssetFolderId },
                    { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
                );
                subfolderId = createFolderResponse.data.id;
            }
            
            // --- STEP 4: Register the new asset ---
            const fileHash = await md5File(imageFile.filepath);
            const registerResult = await axios.post(
                `https://api.webflow.com/v2/sites/${siteId}/assets`,
                { fileName: imageFile.originalFilename, fileHash: fileHash, parentFolder: subfolderId },
                { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
            );
            const assetData = registerResult.data;

            // --- STEP 5: Upload the new file ---
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

            // --- STEP 6: Update the CMS Item ---
            const permanentImageUrl = assetData.hostedUrl || assetData.url;
            const payload = { isDraft: false, isArchived: false, fieldData: { [fieldToUpdate]: permanentImageUrl } };
            const patchResult = await axios.patch(
                `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
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


// --- NEW: GET ALL CLUSTERS FOR THE LOGGED-IN USER ---
router.get('/', async (req, res) => {
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        // Step 1: Get the list of cluster IDs the user owns from Firestore.
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists || !userDoc.data().clusters || userDoc.data().clusters.length === 0) {
            // It's not an error if the user has no clusters yet.
            return res.status(200).json({ items: [] });
        }
        const userClusterIds = userDoc.data().clusters;

        // Step 2: Fetch ALL items from the Webflow collection.
        // Note: For very large collections, you would need to handle pagination.
        // For now, this is robust and will work for hundreds/thousands of items.
        const response = await axios.get(
            `https://api.webflow.com/v2/collections/${collectionId}/items`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const allItems = response.data.items;

        // Step 3: Filter the full list to return only the items this user owns.
        const userItems = allItems.filter(item => userClusterIds.includes(item.id));

        res.status(200).json({ items: userItems });

    } catch (error) {
        console.error(`Error fetching clusters for user ${uid}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while fetching clusters.' });
    }
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

// --- NEW: UPDATE AN EXISTING CLUSTER ---
// --- FINAL, CORRECTED UPDATE ROUTE ---
// --- FINAL, COMPLETE UPDATE ROUTE ---
router.patch('/:clusterId', async (req, res) => {
    const { clusterId } = req.params;
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to edit this cluster.' });
        }

        const {
            clusterName, shortDescription, longDescription, discordUsername,
            discordInviteLink, websiteLink, clusterLocation, game, gameVersion,
            gameType, gameMode, numberOfMaps, tribeSize, harvestRates,
            platformsPc, platformsXbox, platformsPlaystation, windows1011
        } = req.body;

        const payload = {
            isArchived: false, isDraft: false,
            fieldData: {
                'name': clusterName,
                'slug': clusterName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 255),
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

        const response = await axios.patch(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            payload,
            { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json", "accept-version": "1.0.0" } }
        );

        res.status(200).json({
            message: 'Cluster updated successfully!',
            data: response.data
        });
    } catch (error) {
        console.error(`Error updating cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while updating cluster.' });
    }
});

// --- NEW: DELETE A CLUSTER ---
router.delete('/:clusterId', async (req, res) => {
    const { clusterId } = req.params;
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        // Step 1: Security check - Verify this user owns this cluster.
        const db = getFirestore();
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to delete this cluster.' });
        }

        // Step 2: Delete the item from the Webflow CMS.
        console.log(`Attempting to delete Webflow item: ${clusterId}`);
        await axios.delete(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        console.log(`Webflow item deleted successfully.`);

        // Step 3: Unlink the cluster from the user in Firestore.
        console.log(`Removing cluster ID from user's record in Firestore...`);
        await userDocRef.update({
            clusters: FieldValue.arrayRemove(clusterId)
        });
        console.log(`Firestore record updated.`);

        // NOTE: We are NOT deleting the asset folder or assets. This is a safety measure.
        // A future admin tool could be built to clean up orphaned asset folders if needed.

        res.status(200).json({ message: 'Cluster deleted successfully.' });

    } catch (error) {
        console.error(`Error deleting cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while deleting cluster.' });
    }
});

/// --- NEW: PUBLISH A SINGLE CLUSTER ---
// --- FINAL CORRECTED VERSION: PUBLISH A SINGLE CLUSTER ITEM ---
router.post('/:clusterId/publish', async (req, res) => {
    const { clusterId } = req.params;
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        // Step 1: Security check (stays the same)
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to publish this cluster.' });
        }

        // Step 2: Fetch the item to get its slug for the return URL.
        const itemResponse = await axios.get(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            { headers: { "Authorization": `Bearer ${apiToken}`, "accept-version": "1.0.0" } }
        );
        const clusterSlug = itemResponse.data.fieldData.slug;

        // Step 3: Publish the specific item using the correct POST endpoint.
        console.log(`Step 3: Publishing item ${clusterId} in collection ${collectionId}`);
        const publishResponse = await axios.post(
            `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
            { itemIds: [clusterId] }, // The API expects an array of item IDs
            { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
        );

        // The API returns 202 Accepted if the publish job starts successfully.
        if (publishResponse.status !== 202) {
            console.error("Webflow API did not accept the publish request.", publishResponse.data);
            throw new Error('Webflow API did not confirm the item was published.');
        }

        // Publishing is asynchronous. It can take a moment to go live.
        const liveUrl = `https://sclhub.webflow.io/directory-asa/${clusterSlug}`; // Replace with your site's actual URL structure

        res.status(200).json({
            message: 'Publishing started! Your cluster will be live in a minute.',
            publishedUrl: liveUrl
        });

    } catch (error) {
        console.error(`Error publishing cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while publishing cluster.' });
    }


});


module.exports = router;