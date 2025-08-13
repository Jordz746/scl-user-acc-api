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

// ... (the other require and initialization code stays the same) ...

const verifyFirebaseToken = async (req, res, next) => {
  // BREADCRUMB 1: Did the middleware start?
  console.log('Entering verifyFirebaseToken middleware...');
  
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No Firebase ID token was passed.');
    return res.status(403).send('Unauthorized');
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // BREADCRUMB 2: Are we about to call Google?
    console.log('Attempting to verify token...');
    
    // THE SUSPECTED HANG IS HERE:
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // BREADCRUMB 3: Did the call to Google succeed?
    console.log('Token verified successfully for UID:', decodedToken.uid);
    
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error while verifying Firebase ID token:', error);
    res.status(403).send('Unauthorized');
  }
};

module.exports = {
  verifyFirebaseToken
};