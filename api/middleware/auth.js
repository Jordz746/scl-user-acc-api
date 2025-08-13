const admin = require('firebase-admin');

// --- Initialize Firebase Admin SDK ---
// This block of code will only run once when the server starts.

// Parse the service account key from the environment variable.
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);

// Check if Firebase Admin has already been initialized.
// This prevents errors in a serverless environment where files can be re-run.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
// --- End of Initialization ---


/**
 * Express middleware that validates Firebase ID Tokens passed in the Authorization header.
 * The Firebase ID token needs to be passed as a Bearer token in the Authorization header.
 * e.g. 'Authorization: Bearer <token>'
 * If the token is valid, the decoded token is attached to the request object as `req.user`
 * and the request is passed to the next handler.
 * If the token is not valid, a 403 Unauthorized response is sent.
 */
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No Firebase ID token was passed as a Bearer token in the Authorization header.');
    return res.status(403).send('Unauthorized');
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // verifyIdToken() checks if the token is valid and not expired.
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Attach the user's data (like their UID) to the request object.
    // This allows subsequent handlers to know who the user is.
    req.user = decodedToken;
    next(); // Pass control to the next handler.
  } catch (error) {
    console.error('Error while verifying Firebase ID token:', error);
    res.status(403).send('Unauthorized');
  }
};

module.exports = {
  verifyFirebaseToken
};