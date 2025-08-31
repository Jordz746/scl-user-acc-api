// routes/admin.js

const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const axios = require('axios');

// --- HELPER FUNCTION TO DELETE ALL ASSETS FOR A CLUSTER ---
// This is the same robust helper we perfected for the user-facing delete.
const deleteAllAssetsForCluster = async (clusterId, siteId, apiToken) => {
    console.log(`Admin starting asset cleanup for cluster: ${clusterId}`);
    try {
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

        const folderDetailsResponse = await axios.get(
            `https://api.webflow.com/v2/asset_folders/${folderIdToDelete}`,
            { headers: { "Authorization": `Bearer ${apiToken}` } }
        );
        const assetIdsToDelete = folderDetailsResponse.data.assets;

        if (assetIdsToDelete && assetIdsToDelete.length > 0) {
            console.log(`Found ${assetIdsToDelete.length} assets to delete.`);
            const deletePromises = assetIdsToDelete.map(assetId => {
                return axios.delete(
                    `https://api.webflow.com/v2/assets/${assetId}`,
                    { headers: { "Authorization": `Bearer ${apiToken}` } }
                );
            });
            await Promise.all(deletePromises);
            console.log("All assets in folder have been deleted.");
        }
        
        // As per documentation, we cannot delete the folder itself, but we have emptied it.
        console.log("Asset deletion complete. The empty folder will remain.");

    } catch (error) {
        console.error("An error occurred during asset cleanup.", error.message);
        // We throw the error so the main function knows something went wrong.
        throw error;
    }
};

const router = express.Router();

// --- ADMIN DELETE ENDPOINT ---
// Triggered by visiting GET /api/admin/delete-cluster/:clusterIdToDelete
router.get('/delete-cluster/:clusterIdToDelete', async (req, res) => {
    const { clusterIdToDelete } = req.params;
    
    const apiToken = process.env.WEBFLOW_API_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;
    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    console.log(`ADMIN ACTION: Received request to delete cluster ${clusterIdToDelete}`);

    try {
        // --- STEP 1: Find the original owner of the cluster ---
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

        // --- STEP 2: Perform the full asset cleanup ---
        await deleteAllAssetsForCluster(clusterIdToDelete, siteId, apiToken);
        
        // --- STEP 3: Delete the CMS Item ---
        try {
            await axios.delete(
                `https://api.webflow.com/v2/collections/${collectionId}/items/${clusterIdToDelete}`,
                { headers: { "Authorization": `Bearer ${apiToken}` } }
            );
            console.log(`Successfully deleted CMS item: ${clusterIdToDelete}`);
        } catch (deleteItemError) {
             console.warn(`Could not delete CMS item ${clusterIdToDelete}, it may have already been deleted.`);
        }

        // --- STEP 4: Unlink from original owner in Firestore ---
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
        
        // --- STEP 5: Delete the cluster's asset-tracking document ---
        const clusterAssetDocRef = db.collection('clusters').doc(clusterIdToDelete);
        if ((await clusterAssetDocRef.get()).exists) {
            await clusterAssetDocRef.delete();
            console.log(`Deleted asset tracking document from 'clusters' collection.`);
        }

        // Send a friendly HTML response directly to your browser
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