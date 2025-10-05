// routes/admin.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const axios = require('axios');
const { Formidable } = require('formidable');
const fs = require('fs');
const md5File = require('md5-file');
const FormData = require('form-data');

// --- Re-usable Helper Functions ---
// We need some helpers from your clusters.js file, so we'll redefine them here
// to keep this file self-contained and independent.

const fetchAllAssetFolders = async (siteId, apiToken) => {
    // This function is a direct copy from clusters.js - it's robust and handles pagination.
    let allFolders = [];
    let offset = 0;
    const limit = 100;
    let hasNextPage = true;
    console.log("ADMIN: Fetching all asset folders with pagination...");
    while (hasNextPage) {
        const response = await axios.get(
            `https://api.webflow.com/v2/sites/${siteId}/asset_folders?offset=${offset}&limit=${limit}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const { assetFolders, pagination } = response.data;
        if (assetFolders && assetFolders.length > 0) {
            allFolders = allFolders.concat(assetFolders);
        }
        if (pagination.offset + assetFolders.length < pagination.total) {
            offset += limit;
        } else {
            hasNextPage = false;
        }
    }
    console.log(`ADMIN: Finished fetching. Found ${allFolders.length} total folders.`);
    return allFolders;
};

const deleteAllAssetsForCluster = async (clusterId, siteId, apiToken) => {
    console.log(`ADMIN: Starting asset cleanup for cluster: ${clusterId}`);
    try {
        const allFolders = await fetchAllAssetFolders(siteId, apiToken);
        const folderToDelete = allFolders.find(f => f.displayName === clusterId);

        if (!folderToDelete) {
            console.log("ADMIN: No matching asset folder found. Asset cleanup skipped.");
            return;
        }
        const folderIdToDelete = folderToDelete.id;
        console.log(`ADMIN: Found asset folder to delete with ID: ${folderIdToDelete}`);

        const folderDetailsResponse = await axios.get(
            `https://api.webflow.com/v2/asset_folders/${folderIdToDelete}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const assetIdsToDelete = folderDetailsResponse.data.assets;

        if (assetIdsToDelete && assetIdsToDelete.length > 0) {
            console.log(`ADMIN: Found ${assetIdsToDelete.length} assets to delete.`);
            const deletePromises = assetIdsToDelete.map(assetId => {
                return axios.delete(
                    `https://api.webflow.com/v2/assets/${assetId}`,
                    { headers: { "Authorization": `Bearer ${apiToken}` } }
                );
            });
            await Promise.all(deletePromises);
            console.log("ADMIN: All assets in folder have been deleted.");
        }
        
        console.log("ADMIN: Asset deletion complete. The empty folder will remain.");

    } catch (error) {
        console.error("ADMIN: An error occurred during asset cleanup.", error.response ? error.response.data : error.message);
        throw error;
    }
};

const router = express.Router();

// --- NEW: ADMIN GET CLUSTER DETAILS ENDPOINT ---
// This is the main endpoint for populating your admin dashboard.
router.get('/cluster/:clusterId', async (req, res) => {
    const { clusterId } = req.params;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    console.log(`ADMIN: Received request to get details for cluster ${clusterId}`);

    try {
        // --- Step 1: Fetch the main cluster data from Webflow ---
        const itemResponse = await axios.get(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const webflowData = itemResponse.data;
        const ownerUid = webflowData.fieldData['firebase-uid'];

        // --- Step 2: Fetch the owner's email from Firebase ---
        let ownerEmail = 'N/A';
        if (ownerUid) {
            try {
                const userRecord = await admin.auth().getUser(ownerUid);
                ownerEmail = userRecord.email;
            } catch (userError) {
                console.warn(`ADMIN: Could not fetch Firebase user for UID: ${ownerUid}. They may have been deleted.`);
                ownerEmail = 'Firebase user not found';
            }
        }

        // --- Step 3: Fetch asset data from Firestore ---
        const db = getFirestore();
        const clusterAssetDoc = await db.collection('clusters').doc(clusterId).get();
        const firestoreAssets = clusterAssetDoc.exists ? clusterAssetDoc.data().assets : {};

        // --- Step 4: Combine all data into a single response ---
        const combinedData = {
            webflow: webflowData,
            owner: {
                uid: ownerUid,
                email: ownerEmail
            },
            assets: firestoreAssets // This will contain URLs for logo, banner-16-9, etc.
        };

        res.status(200).json(combinedData);

    } catch (error) {
        console.error(`ADMIN: Error fetching details for cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ message: `Cluster with ID ${clusterId} not found in Webflow.` });
        }
        res.status(500).json({ message: 'Server error while fetching cluster details.' });
    }
});


// --- NEW: ADMIN UPDATE CLUSTER ENDPOINT ---
router.patch('/cluster/:clusterId', async (req, res) => {
    const { clusterId } = req.params;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    console.log(`ADMIN: Received request to update cluster ${clusterId}`);

    try {
        // The payload is the entire request body, which should match the user-facing update structure.
        const payload = {
            isArchived: false, 
            isDraft: false,
            fieldData: req.body
        };

        const response = await axios.patch(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            payload,
            { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
        );

        res.status(200).json({
            message: 'Admin successfully updated cluster!',
            data: response.data
        });
    } catch (error) {
        console.error(`ADMIN: Error updating cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while updating cluster.' });
    }
});


// --- NEW: ADMIN UPLOAD IMAGE ENDPOINT ---
router.post('/cluster/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query; 
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;
    const parentAssetFolderId = process.env.WEBFLOW_PARENT_ASSET_FOLDER_ID;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    console.log(`ADMIN: Received image upload request for cluster ${clusterId}, type: ${type}`);

    try {
        // --- Promisified Form Parsing ---
        const { files } = await new Promise((resolve, reject) => {
            const form = new Formidable();
            form.parse(req, (err, fields, files) => {
                if (err) { reject(new Error('Error parsing form data')); return; }
                resolve({ fields, files });
            });
        });
        
        const imageFile = files.image?.[0];
        if (!imageFile) return res.status(400).json({ message: 'No image file uploaded' });

        // --- File validation (same as user-facing route) ---
        const MAX_SIZE_MB = 3.5;
        if (imageFile.size > MAX_SIZE_MB * 1024 * 1024) {
            return res.status(400).json({ message: `File is too large. Max size is ${MAX_SIZE_MB}MB.` });
        }
        const ALLOWED_TYPES = ['image/webp'];
        if (!ALLOWED_TYPES.includes(imageFile.mimetype)) {
            return res.status(400).json({ message: 'Invalid file type. Only WEBP allowed.' });
        }

        // --- Step 1: Check Firestore for old assetId and delete if exists ---
        const db = getFirestore();
        const clusterDoc = await db.collection('clusters').doc(clusterId).get();
        const clusterAssets = clusterDoc.data()?.assets || {};
        const oldAsset = clusterAssets[type];
        if (oldAsset?.assetId) {
            try {
                console.log(`ADMIN: Deleting old asset: ${oldAsset.assetId}`);
                await axios.delete(
                    `https://api.webflow.com/v2/assets/${oldAsset.assetId}`,
                    { headers: { "Authorization": `Bearer ${apiToken}` } }
                );
                console.log("ADMIN: Old asset deleted.");
            } catch (deleteErr) {
                console.warn("ADMIN: Failed to delete old asset (it may have already been removed):", deleteErr.message);
            }
        }

        // --- Step 2: "GET OR CREATE" SUBFOLDER ---
        let subfolderId = null;
        const allFolders = await fetchAllAssetFolders(siteId, apiToken);
        const existingFolder = allFolders.find(f => f.displayName === clusterId);

        if (existingFolder) {
            subfolderId = existingFolder.id;
            console.log(`ADMIN: Found existing subfolder with ID: ${subfolderId}`);
        } else {
            console.log(`ADMIN: No existing folder found. Creating a new one...`);
            const createFolderResponse = await axios.post(
                `https://api.webflow.com/v2/sites/${siteId}/asset_folders`,
                { displayName: clusterId, parentFolder: parentAssetFolderId },
                { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
            );
            subfolderId = createFolderResponse.data.id;
            console.log(`ADMIN: Successfully created new subfolder with ID: ${subfolderId}`);
        }

        // --- Step 3: Register new asset ---
        const fileExtension = imageFile.originalFilename.split('.').pop();
        const timestamp = Date.now();
        const newUniqueFileName = `${type}_${clusterId}_${timestamp}.${fileExtension}`;
        const fileHash = await md5File(imageFile.filepath);
        const registerResult = await axios.post(
            `https://api.webflow.com/v2/sites/${siteId}/assets`,
            { fileName: newUniqueFileName, fileHash: fileHash, parentFolder: subfolderId },
            { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
        );
        const assetData = registerResult.data;

        // --- Step 4: Upload file ---
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

        // --- Step 5: Update CMS item ---
        const permanentImageUrl = assetData.hostedUrl || assetData.url;
        const fieldToUpdate = {
            'logo-1-1': '1-1-cluster-logo-image-link',
            'banner-16-9': '16-9-banner-image-link',
            'banner-9-16': '9-16-banner-image-link'
        }[type];
        if (!fieldToUpdate) return res.status(400).json({ message: 'Invalid image type.' });
        const cmsPayload = { isDraft: false, isArchived: false, fieldData: { [fieldToUpdate]: permanentImageUrl } };
        await axios.patch(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            cmsPayload,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );

        // --- Step 6: Save new assetId + URL in Firestore to keep user's record in sync ---
        await db.collection('clusters').doc(clusterId).set({
            assets: {
                [type]: {
                    assetId: assetData.id,
                    url: permanentImageUrl
                }
            }
        }, { merge: true });

        // --- Step 7: Clean up temp file ---
        fs.unlink(imageFile.filepath, () => {});

        res.status(200).json({
            message: "Admin successfully uploaded image and updated cluster!",
            imageUrl: permanentImageUrl
        });

    } catch (error) {
        console.error(`ADMIN: Error during image upload for cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error during image upload.' });
    }
});


// --- NEW: ADMIN PUBLISH CLUSTER ENDPOINT ---
router.post('/cluster/:clusterId/publish', async (req, res) => {
    const { clusterId } = req.params;
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    console.log(`ADMIN: Received request to publish cluster ${clusterId}`);

    try {
        // Step 1: Fetch the item to get its slug for the return URL.
        const itemResponse = await axios.get(
            `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterId}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const clusterSlug = itemResponse.data.fieldData.slug;

        // Step 2: Publish the specific item.
        const publishResponse = await axios.post(
            `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
            { itemIds: [clusterId] },
            { headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" } }
        );

        if (publishResponse.status !== 202) {
            throw new Error('Webflow API did not confirm the item was published.');
        }

        const liveUrl = `https://sclhub.webflow.io/directory-asa/${clusterSlug}`; 

        res.status(200).json({
            message: 'Publishing started! The cluster will be live in a minute.',
            publishedUrl: liveUrl
        });

    } catch (error) {
        console.error(`ADMIN: Error publishing cluster ${clusterId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Server error while publishing cluster.' });
    }
});


// --- EXISTING ADMIN DELETE ENDPOINT (UNCHANGED) ---
// This remains a GET request as per your existing special implementation.
router.get('/delete-cluster/:clusterIdToDelete', async (req, res) => {
    const { clusterIdToDelete } = req.params;
    
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    console.log(`ADMIN ACTION: Received request to delete cluster ${clusterIdToDelete}`);

    try {
        // --- Step 1: Find the original owner of the cluster ---
        const db = getFirestore();
        let ownerUid = null;
        try {
            const itemResponse = await axios.get(
                `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterIdToDelete}`,
                { headers: { "Authorization": `Bearer ${apiToken}` } }
            );
            ownerUid = itemResponse.data.fieldData['firebase-uid'];
            console.log(`Found original owner UID: ${ownerUid}`);
        } catch(getItemError) {
            console.warn(`Could not fetch CMS item ${clusterIdToDelete}, it may already be deleted.`);
        }

        // --- Step 2: Perform the full asset cleanup ---
        await deleteAllAssetsForCluster(clusterIdToDelete, siteId, apiToken);
        
        // --- Step 3: Delete the CMS Item ---
        try {
            await axios.delete(
                `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterIdToDelete}`,
                { headers: { "Authorization": `Bearer ${apiToken}` } }
            );
            console.log(`Successfully deleted CMS item: ${clusterIdToDelete}`);
        } catch (deleteItemError) {
             console.warn(`Could not delete CMS item ${clusterIdToDelete}, it may have already been deleted.`);
        }

        // --- Step 4: Unlink from original owner in Firestore ---
        if (ownerUid) {
            const ownerDocRef = db.collection('users').doc(ownerUid);
            const ownerDoc = await ownerDocRef.get();
            if (ownerDoc.exists) {
                await ownerDocRef.update({
                    clusters: FieldValue.arrayRemove(clusterIdToDelete)
                });
                console.log(`Removed cluster link from original owner: ${ownerUid}`);
            }
        }
        
        // --- Step 5: Delete the cluster's asset-tracking document ---
        const clusterAssetDocRef = db.collection('clusters').doc(clusterIdToDelete);
        if ((await clusterAssetDocRef.get()).exists) {
            await clusterAssetDocRef.delete();
            console.log(`Deleted asset tracking document from 'clusters' collection.`);
        }

        res.status(200).send(`
            <div style="font-family: sans-serif; padding: 2em;">
                <h1>Success</h1>
                <p>Cluster <strong>${clusterIdToDelete}</strong> and all associated data have been successfully deleted from the system.</p>
            </div>
        `);

    } catch (error) {
        console.error(`Admin delete error:`, error.message);
        res.status(500).send(`
            <div style="font-family: sans-serif; padding: 2em; background: #ffebee; border: 1px solid #c62828;">
                <h1>Error</h1>
                <p>An error occurred during the deletion process. Check the Vercel logs for details.</p>
                <p><strong>Message:</strong> ${error.message}</p>
            </div>
        `);
    }
});

module.exports = router;