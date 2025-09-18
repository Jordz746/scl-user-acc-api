// routes/clusters.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable');
const fs = require('fs');
const md5File = require('md5-file');
const FormData = require('form-data');
const axios = require('axios'); // Our reliable HTTP client

// --- NEW HELPER FUNCTION TO HANDLE PAGINATION ---
const fetchAllAssets = async (siteId, apiToken) => {
    let allAssets = [];
    let offset = 0;
    const limit = 100; // The max limit per request
    let hasNextPage = true;

    console.log("Fetching all assets with pagination...");

    while (hasNextPage) {
        const response = await axios.get(
            `https://api.webflow.com/v2/sites/${siteId}/assets?offset=${offset}&limit=${limit}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );

        const { assets, pagination } = response.data;
        if (assets && assets.length > 0) {
            allAssets = allAssets.concat(assets);
        }

        // Check if there are more assets to fetch
        if (pagination.offset + assets.length < pagination.total) {
            offset += limit;
        } else {
            hasNextPage = false;
        }
    }
    
    console.log(`Finished fetching. Found ${allAssets.length} total assets.`);
    return allAssets;
};

// --- FINAL, DEFINITIVE HELPER TO DELETE ASSETS AND FOLDER ---
const deleteAllAssetsForCluster = async (clusterId, siteId, apiToken) => {
    console.log(`Starting asset cleanup for cluster: ${clusterId}`);
    try {
        // --- STEP 1: Find the Folder's UNIQUE ID ---
        // Find the folder by its displayName, which we set to be the clusterId.
        const listFoldersResponse = await axios.get(
            `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const folderToDelete = listFoldersResponse.data.assetFolders.find(f => f.displayName === clusterId);

        if (!folderToDelete) {
            console.log("No matching asset folder found. Cleanup skipped.");
            return;
        }
        const folderIdToDelete = folderToDelete.id;
        console.log(`Found asset folder to delete with ID: ${folderIdToDelete}`);

        // --- STEP 2: Get the details of THAT FOLDER to find its assets ---
        // This is the correct, definitive way to get the contents of a folder.
        const folderDetailsResponse = await axios.get(
            `https://api.webflow.com/v2/asset_folders/${folderIdToDelete}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const assetIdsToDelete = folderDetailsResponse.data.assets; // This is an array of Asset IDs

        if (!assetIdsToDelete || assetIdsToDelete.length === 0) {
            console.log("No assets found inside the folder. Proceeding to delete the empty folder.");
        } else {
            console.log(`Found ${assetIdsToDelete.length} assets to delete in folder.`);
            // --- STEP 3: Delete each asset found in the folder by its ID ---
            const deletePromises = assetIdsToDelete.map(assetId => {
                console.log(`Queueing asset for deletion: ${assetId}`);
                return axios.delete(
                    `https://api.webflow.com/v2/assets/${assetId}`,
                    { headers: { "Authorization": `Bearer ${apiToken}` } }
                );
            });
            await Promise.all(deletePromises);
            console.log("All assets in folder have been successfully deleted.");
        }

        // --- STEP 4: Delete the now-empty folder ---
        // Note: The API does not currently support deleting asset folders.
        // This line is commented out but kept for future-proofing if Webflow adds the feature.
        /*
        await axios.delete(
            `https://api.webflow.com/v2/asset_folders/${folderIdToDelete}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        console.log(`Successfully deleted asset folder: ${folderIdToDelete}`);
        */
       console.log("Asset deletion complete. The empty folder will remain as per Webflow API limitations.");

    } catch (error) {
        console.error("An error occurred during asset cleanup.", error.message);
    }
};


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
        'slug': clusterName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // 1. Remove all special characters except spaces and hyphens
            .trim()                     // 2. Remove leading/trailing spaces
            .replace(/\s+/g, '-')       // 3. Replace spaces with hyphens
            .replace(/-+/g, '-')        // 4. Replace multiple hyphens with a single one
            .slice(0, 255),
        'firebase-uid': uid,
        'cluster-name': clusterName,
        'cluster-short-description---max-100-characters': shortDescription,
        'cluster-description-rich': longDescription,
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



// routes/clusters.js

// --- UPLOAD AN IMAGE (WITH FIRESTORE ASSET ID TRACKING) ---
router.post('/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query; 
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;
    const parentAssetFolderId = process.env.WEBFLOW_PARENT_ASSET_FOLDER_ID;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        // --- Security check ---
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
            return res.status(403).json({ message: 'Forbidden: You do not own this cluster.' });
        }

        // --- Parse form data ---
        const form = new Formidable();
        form.parse(req, async (err, fields, files) => {
            if (err) return res.status(500).json({ message: 'Error parsing form' });
            const imageFile = files.image?.[0];
            if (!imageFile) return res.status(400).json({ message: 'No image file uploaded' });

            // --- File validation ---
            const MAX_SIZE_MB = 3.5;
            if (imageFile.size > MAX_SIZE_MB * 1024 * 1024) {
                return res.status(400).json({ message: `File is too large. Max size is ${MAX_SIZE_MB}MB.` });
            }
            const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
            if (!ALLOWED_TYPES.includes(imageFile.mimetype)) {
                return res.status(400).json({ message: 'Invalid file type. Only JPG, PNG, and WEBP allowed.' });
            }

            try {
                // --- STEP 1: Check Firestore for old assetId ---
                const clusterDoc = await db.collection('clusters').doc(clusterId).get();
                const clusterAssets = clusterDoc.data()?.assets || {};
                const oldAsset = clusterAssets[type];

                if (oldAsset?.assetId) {
                    try {
                        console.log(`Deleting old asset: ${oldAsset.assetId}`);
                        await axios.delete(
                            `https://api.webflow.com/v2/assets/${oldAsset.assetId}`,
                            { headers: { "Authorization": `Bearer ${apiToken}` } }
                        );
                        console.log("Old asset deleted.");
                    } catch (deleteErr) {
                        console.error("Failed to delete old asset:", deleteErr.message);
                    }
                }

                    // --- STEP 3: DEFINITIVE "GET OR CREATE" SUBFOLDER ---
                    let subfolderId = null;

                    // First, we ALWAYS check if the folder exists.
                    console.log(`Checking for existing asset folder: ${clusterId}`);
                    const listFoldersResponse = await axios.get(
                        `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
                        { headers: { "Authorization": `Bearer ${apiToken}` } }
                    );

                    const existingFolder = listFoldersResponse.data.assetFolders.find(f => f.displayName === clusterId);

                    if (existingFolder) {
                        // If we find it, we use its ID.
                        subfolderId = existingFolder.id;
                        console.log(`Found existing subfolder with ID: ${subfolderId}`);
                    } else {
                        // If and ONLY IF we don't find it, we create it.
                        console.log(`No existing folder found. Creating a new one...`);
                        try {
                            const createFolderResponse = await axios.post(
                                `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
                                { displayName: clusterId, parentFolder: parentAssetFolderId },
                                { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
                            );
                            subfolderId = createFolderResponse.data.id;
                            console.log(`Successfully created new subfolder with ID: ${subfolderId}`);
                        } catch (createError) {
                            // This is a safety net. If creation fails with a conflict, it means
                            // a parallel request just created it. We can consider this a non-fatal issue
                            // and try to proceed, but log a clear warning.
                            if (createError.response && createError.response.data.code === 'conflict') {
                                console.warn("Caught a conflict error during folder creation. This can happen in a race condition. The upload may fail if the folder cannot be found in time.");
                                // We don't have an ID, so the next step (asset registration) might fail,
                                // but the user can simply try again. This prevents the server from crashing.
                            } else {
                                // It was a different, more serious error.
                                throw createError;
                            }
                        }
                    }

                    // This check is a final safeguard.
                    if (!subfolderId) {
                        // If, after all of that, we still don't have an ID, we cannot proceed.
                        // This will provide a clear error message to the user.
                        return res.status(500).json({ message: 'Could not create or find an asset folder for this cluster. Please try again in a moment.' });
                    }

                // --- STEP 3: Register new asset ---
                const fileExtension = imageFile.originalFilename.split('.').pop();
                const timestamp = Date.now();
                const newUniqueFileName = `${type}_${clusterId}_${timestamp}.${fileExtension}`;
                const fileHash = await md5File(imageFile.filepath);

                const registerResult = await axios.post(
                    `https://api.webflow.com/v2/sites/${siteId}/assets`,
                    { 
                        fileName: newUniqueFileName,
                        fileHash: fileHash,
                        parentFolder: subfolderId 
                    },
                    { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
                );

                const assetData = registerResult.data;

                // --- STEP 4: Upload file ---
                const uploadUrl = assetData.uploadUrl;
                const fileStream = fs.createReadStream(imageFile.filepath);
                const formData = new FormData();
                const uploadFields = assetData.uploadDetails || assetData.fields;
                if (!uploadFields) throw new Error("Invalid Webflow upload details.");
                Object.keys(uploadFields).forEach(key => formData.append(key, uploadFields[key]));
                formData.append('file', fileStream);

                const uploadResult = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
                if (![200, 201, 204].includes(uploadResult.status)) {
                    throw new Error(`File upload failed with status: ${uploadResult.status}`);
                }

                // --- STEP 5: Update CMS item ---
                const permanentImageUrl = assetData.hostedUrl || assetData.url;
                const fieldToUpdate = {
                    'logo-1-1': '1-1-cluster-logo-image-link',
                    'banner-16-9': '16-9-banner-image-link',
                    'banner-9-16': '9-16-banner-image-link'
                }[type];
                if (!fieldToUpdate) return res.status(400).json({ message: 'Invalid image type.' });

                const payload = { isDraft: false, isArchived: false, fieldData: { [fieldToUpdate]: permanentImageUrl } };
                const patchResult = await axios.patch(
                    `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
                    payload,
                    { headers: { "Authorization": `Bearer ${apiToken}` } }
                );

                // --- STEP 6: Save new assetId + URL in Firestore ---
                await db.collection('clusters').doc(clusterId).set({
                    assets: {
                        [type]: {
                            assetId: assetData.id,
                            url: permanentImageUrl
                        }
                    }
                }, { merge: true });

                // --- STEP 7: Clean up temp file ---
                fs.unlink(imageFile.filepath, () => {});

                res.status(200).json({
                    message: "Image uploaded and cluster updated successfully!",
                    imageUrl: permanentImageUrl,
                    updatedItem: patchResult.data
                });

            } catch (error) {
                console.error('Error during image upload:', error.response ? error.response.data : error.message);
                res.status(500).json({ message: 'Server error during image upload.' });
            }
        });
    } catch (outerErr) {
        console.error('Outer error in image upload route:', outerErr.message);
        res.status(500).json({ message: 'Unexpected server error.' });
    }
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
                'slug': clusterName
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, '') // 1. Remove all special characters except spaces and hyphens
                        .trim()                     // 2. Remove leading/trailing spaces
                        .replace(/\s+/g, '-')       // 3. Replace spaces with hyphens
                        .replace(/-+/g, '-')        // 4. Replace multiple hyphens with a single one
                        .slice(0, 255),
                'cluster-name': clusterName,
                'cluster-short-description---max-100-characters': shortDescription,
                'cluster-description-rich': longDescription,
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
// --- DELETE A CLUSTER (WITH ASSET CLEANUP) ---
router.delete('/:clusterId', async (req, res) => {
    const { clusterId } = req.params;
    const { uid } = req.user;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID; // We need siteId for cleanup
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    try {
        // Step 1: Security check - Verify this user owns this cluster.
        const db = getFirestore();
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
            return res.status(403).json({ message: 'Forbidden: You do not have permission to delete this cluster.' });
        }

        // --- Step 2: ASSET CLEANUP ---
        // We do this first. If it fails for any reason, the try/catch inside the helper
        // will log the error, but allow the rest of the deletion process to continue.
        await deleteAllAssetsForCluster(clusterId, siteId, apiToken);

        // Step 3: Delete the item from the Webflow CMS.
        console.log(`Attempting to delete Webflow CMS item: ${clusterId}`);
        await axios.delete(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        console.log(`Webflow CMS item deleted successfully.`);

        // Step 4: Unlink the cluster from the main user record in Firestore.
        console.log(`Removing cluster ID from user's record in Firestore...`);
        await userDocRef.update({
            clusters: FieldValue.arrayRemove(clusterId)
        });
        
        // Step 5: Delete the cluster's specific asset-tracking document from Firestore.
        await db.collection('clusters').doc(clusterId).delete();
        console.log(`Firestore records updated and cleaned.`);

        res.status(200).json({ message: 'Cluster and all associated assets deleted successfully.' });

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