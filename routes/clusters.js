const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { Formidable } = require('formidable'); // We need this for file uploads
const fs = require('fs'); // And this to read the uploaded file from disk

const webflow = require('../services/webflow');

const router = express.Router();

// ... the existing POST '/' route is here ...
// (No changes needed to the cluster creation route)
router.post('/', async (req, res) => {
  try {
    const { uid } = req.user; // User ID from our auth middleware
    const { clusterName, shortDescription, longDescription } = req.body;

    // 1. Basic Input Validation
    if (!clusterName || !shortDescription) {
      return res.status(400).json({ message: 'Cluster Name and Short Description are required.' });
    }

    const collectionId = process.env.WEBFLOW_CLUSTER_COLLECTION_ID;

    // 2. Prepare the data for the Webflow CMS
    // IMPORTANT: Replace 'name', 'short-description', etc. with YOUR actual field slugs.
    const fields = {
      'name': clusterName,
      'short-description': shortDescription,
      'long-description': longDescription,
      '_archived': false,
      '_draft': false 
    };
    
    // 3. Create the item in Webflow CMS
    console.log("Attempting to create Webflow item...");
    const newWebflowItem = await webflow.createItem({
      collectionId: collectionId,
      fields: fields
    }, { live: true });
    console.log("Webflow item created successfully:", newWebflowItem.id);

    const newClusterId = newWebflowItem.id;

    // 4. Link the new Webflow Cluster ID to the user in Firestore
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    
    console.log("Attempting to write to Firestore for user:", uid);
    await userRef.set({
        clusters: FieldValue.arrayUnion(newClusterId)
    }, { merge: true });
    console.log("Firestore write successful.");

    // 5. Send a success response back to the client
    // THIS IS THE LINE THAT PREVENTS THE TIMEOUT
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

// --- The image upload route below this stays the same ---
router.post('/:clusterId/image', async (req, res) => {
    // ... all the image upload code ...
});

/**
 * @route   POST /api/clusters/:clusterId/image
 * @desc    Upload an image, associate it with a cluster, and update the CMS item
 * @access  Private (requires Firebase token)
 * @query   ?type=logo or ?type=banner (to specify which field to update)
 */
router.post('/:clusterId/image', async (req, res) => {
    const { clusterId } = req.params;
    const { type } = req.query; // 'logo', 'banner', etc.
    const { uid } = req.user;

    // --- 1. Security Check & Validation ---
    if (!clusterId) {
        return res.status(400).json({ message: 'Cluster ID is required.' });
    }
    if (!type) {
        return res.status(400).json({ message: 'Image type query parameter is required (e.g., ?type=logo).' });
    }

    // Security: Verify the user owns this cluster before allowing an upload
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data().clusters.includes(clusterId)) {
        return res.status(403).json({ message: 'Forbidden: You do not own this cluster.' });
    }

    // --- 2. Handle the File Upload with Formidable ---
    const form = new Formidable();
    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error('Error parsing form:', err);
            return res.status(500).json({ message: 'Error processing file upload.' });
        }

        // 'image' should match the name attribute of your file input on the frontend
        const imageFile = files.image?.[0]; 

        if (!imageFile) {
            return res.status(400).json({ message: 'No image file was uploaded.' });
        }

        try {
            // --- 3. Get an Upload URL from Webflow ---
            const assetMetadata = await webflow.createAssetMetadata({
                fileName: imageFile.originalFilename,
                contentType: imageFile.mimetype,
                size: imageFile.size,
                // We'll create a folder named after the cluster ID for organization
                parentFolder: clusterId
            });
            
            const { uploadUrl, asset } = assetMetadata;

            // --- 4. Upload the File to the URL Webflow Gave Us ---
            const fileData = fs.readFileSync(imageFile.filepath);
            await webflow.uploadAsset(uploadUrl, fileData, imageFile.mimetype);

            // The asset is now in Webflow! The permanent URL is in asset.url
            const permanentImageUrl = asset.url;

            // --- 5. Update the Webflow CMS Item ---
            
            // Map the 'type' query param to the actual Webflow field slug
            // IMPORTANT: Replace these slugs with your actual field slugs from Webflow!
            const fieldToUpdate = {
                logo: 'cluster-logo-url',
                banner: 'banner-image-url'
            }[type];

            if (!fieldToUpdate) {
                return res.status(400).json({ message: 'Invalid image type specified.' });
            }

            const fieldsToUpdate = {
                [fieldToUpdate]: permanentImageUrl
            };
            
            // Use patchItem to update only specific fields without affecting others
            const updatedItem = await webflow.patchItem({
                collectionId: process.env.WEBFLOW_CLUSTER_COLLECTION_ID,
                itemId: clusterId,
                fields: fieldsToUpdate
            }, { live: true }); // Publish the change immediately

            res.status(200).json({
                message: 'Image uploaded and cluster updated successfully!',
                imageUrl: permanentImageUrl,
                updatedItem: updatedItem
            });

        } catch (error) {
            console.error('Error during Webflow asset upload:', error);
            if (error.response && error.response.data) {
                console.error('Webflow API Error:', error.response.data);
                // Handle the case where the asset folder doesn't exist yet
                if (error.response.data.code === 'invalid_parent_folder') {
                    try {
                        // Create the asset folder and then re-run the logic.
                        // For simplicity in this guide, we'll just tell the user to try again.
                        // A more robust implementation would retry the upload after creating the folder.
                        await webflow.createAssetFolder({ parentFolder: '', displayName: clusterId });
                        return res.status(409).json({ message: 'Asset folder created. Please try uploading the image again.' });
                    } catch (folderError) {
                        console.error('Error creating asset folder:', folderError);
                        return res.status(500).json({ message: 'Could not create asset folder.' });
                    }
                }
            }
            res.status(500).json({ message: 'Server error during file upload.' });
        }
    });
});


module.exports = router;