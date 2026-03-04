const admin = require('firebase-admin');
const fs = require('fs');

// Initialize Firebase Admin SDK
let app;
let firestoreInstance;

function initializeFirebase() {
  if (admin.apps.length > 0) {
    console.log('✅ Firebase Admin already initialized');
    return admin.app();
  }

  try {
    let credential;
    let initMethod = 'unknown';

    // Option 1: Use service account JSON (recommended for local dev)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        credential = admin.credential.cert(serviceAccount);
        initMethod = 'service account JSON';
      } catch (parseError) {
        console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', parseError.message);
        throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON format');
      }
    } 
    // Option 2: Use service account key file path
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      try {
        const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
        if (!fs.existsSync(filePath)) {
          throw new Error(`Service account file not found: ${filePath}`);
        }
        const serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        credential = admin.credential.cert(serviceAccount);
        initMethod = 'service account file';
      } catch (fileError) {
        console.error('❌ Failed to read service account file:', fileError.message);
        throw fileError;
      }
    }
    // Option 3: Use individual credentials (for Vercel deployment)
    else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      });
      initMethod = 'individual credentials';
    } 
    // Option 4: No credentials - throw error
    else {
      throw new Error(
        'No Firebase credentials found. Please set one of:\n' +
        '  - FIREBASE_SERVICE_ACCOUNT (full JSON string)\n' +
        '  - FIREBASE_SERVICE_ACCOUNT_PATH (path to .json file)\n' +
        '  - FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL + FIREBASE_PROJECT_ID'
      );
    }

    app = admin.initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID || 'test-590a3'
    });

    console.log(`✅ Firebase Admin initialized with ${initMethod}`);
    console.log(`📊 Project ID: ${app.options.projectId}`);
    
    return app;
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error.message);
    console.error('💡 Check your environment variables and service account permissions');
    throw error;
  }
}

// Get Firestore instance with settings
function getFirestore() {
  if (!firestoreInstance) {
    firestoreInstance = admin.firestore();
    
    // Configure Firestore settings
    firestoreInstance.settings({
      ignoreUndefinedProperties: true
    });
    
    console.log('✅ Firestore instance created');
  }
  return firestoreInstance;
}

// Initialize Firebase on module load
try {
  app = initializeFirebase();
} catch (error) {
  console.error('⚠️ Firebase initialization failed on module load');
  console.error('⚠️ APIs will not work until credentials are properly configured');
}

// Export Firestore instance and admin
const db = app ? getFirestore() : null;

module.exports = { db, admin, getFirestore, initializeFirebase };
module.exports.default = admin;
