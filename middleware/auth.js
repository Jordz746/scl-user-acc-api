// middleware/auth.js

const admin = require('firebase-admin');

// --- Initialize Firebase Admin SDK ---
// This block of code will only run once when the server starts.
if (process.env.FIREBASE_ADMIN_SDK) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
    } catch (e) {
        console.error('Failed to parse or initialize Firebase Admin SDK:', e);
    }
}
// --- End of Initialization ---


// --- Middleware for Standard User Authentication ---
const verifyFirebaseToken = async (req, res, next) => {
    console.log('Entering verifyFirebaseToken middleware...');
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('No Firebase ID token was passed.');
        return res.status(403).send('Unauthorized');
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        console.log('Attempting to verify token...');
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log('Token verified successfully for UID:', decodedToken.uid);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error while verifying Firebase ID token:', error);
        res.status(403).send('Unauthorized');
    }
};


// --- Middleware for Admin HTTP Basic Authentication ---
const adminAuth = (req, res, next) => {
    const adminUser = process.env.ADMIN_USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD;

    if (!adminUser || !adminPass) {
        console.error("FATAL: ADMIN_USERNAME or ADMIN_PASSWORD is not set.");
        return res.status(500).send("<h1>Server Error</h1><p>Server is not configured for admin access.</p>");
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="SCL Hub Admin Area"');
        return res.status(401).send('<h1>Authentication Required</h1><p>You must provide admin credentials to access this page.</p>');
    }

    const encodedCreds = authHeader.split(' ')[1];
    const decodedCreds = Buffer.from(encodedCreds, 'base64').toString('ascii');
    const [username, password] = decodedCreds.split(':');

    if (username === adminUser && password === adminPass) {
        // Credentials are correct, proceed to the actual route handler.
        next();
    } else {
        // Credentials are incorrect.
        console.warn(`Failed admin login attempt with username: ${username}`);
        res.setHeader('WWW-Authenticate', 'Basic realm="SCL Hub Admin Area"');
        return res.status(401).send('<h1>Authentication Failed</h1><p>The username or password you entered is incorrect.</p>');
    }
};


// Export both middleware functions for use in other files.
module.exports = {
  verifyFirebaseToken,
  adminAuth
};