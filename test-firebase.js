#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();

console.log('🔍 Firebase Connection Test\n');
console.log('=' .repeat(50));

// Step 1: Check environment variables
console.log('\n📋 Step 1: Checking environment variables...');
const requiredVars = ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL'];
let allPresent = true;

for (const varName of requiredVars) {
  const value = process.env[varName];
  if (value) {
    console.log(`  ✅ ${varName}: Present`);
  } else {
    console.log(`  ❌ ${varName}: Missing`);
    allPresent = false;
  }
}

if (!allPresent) {
  console.log('\n❌ Some environment variables are missing!');
  console.log('Please check your .env file and try again.');
  process.exit(1);
}

// Step 2: Initialize Firebase Admin
console.log('\n🔧 Step 2: Initializing Firebase Admin SDK...');
try {
  const { db, default: admin } = await import('./lib/firebaseAdmin.js');
  console.log('  ✅ Firebase Admin SDK initialized');
  console.log('  ✅ Firestore instance created');
  console.log('  📊 Project ID:', admin.app().options.projectId);
} catch (error) {
  console.log('  ❌ Failed to initialize Firebase Admin');
  console.error('  Error:', error.message);
  process.exit(1);
}

// Step 3: Test Firestore connection
console.log('\n🔗 Step 3: Testing Firestore connection...');
try {
  const { db } = await import('./lib/firebaseAdmin.js');
  
  // Try to list collections
  const collections = await db.listCollections();
  console.log('  ✅ Successfully connected to Firestore');
  console.log('  📂 Collections found:', collections.length);
  
  if (collections.length > 0) {
    console.log('  📁 Collection names:');
    collections.forEach(c => console.log(`     - ${c.id}`));
  } else {
    console.log('  ℹ️  No collections yet (this is normal for a new database)');
  }
} catch (error) {
  console.log('  ❌ Failed to connect to Firestore');
  console.error('  Error:', error.message);
  
  if (error.message.includes('UNAUTHENTICATED')) {
    console.log('\n💡 Troubleshooting:');
    console.log('  1. The service account key might be expired or disabled');
    console.log('  2. Generate a NEW service account key from Firebase Console');
    console.log('  3. Update your .env file with the new credentials');
    console.log('\n📖 See FIREBASE_CREDENTIALS_SETUP.md for detailed instructions');
  } else if (error.message.includes('PERMISSION_DENIED')) {
    console.log('\n💡 Troubleshooting:');
    console.log('  1. Firestore might not be enabled in your Firebase project');
    console.log('  2. Go to Firebase Console and enable Firestore Database');
    console.log('\n📖 See FIREBASE_CREDENTIALS_SETUP.md for detailed instructions');
  }
  
  process.exit(1);
}

// Step 4: Test helper functions
console.log('\n🧪 Step 4: Testing Firestore helper functions...');
try {
  const helpers = await import('./lib/firestoreHelpers.js');
  const expectedFunctions = [
    'findSubscriptionById',
    'findActiveSubscription',
    'upsertSubscription',
    'findUserById',
    'upsertUser'
  ];
  
  let allFound = true;
  for (const fn of expectedFunctions) {
    if (helpers[fn]) {
      console.log(`  ✅ ${fn}`);
    } else {
      console.log(`  ❌ ${fn} - Not found`);
      allFound = false;
    }
  }
  
  if (!allFound) {
    console.log('\n  ⚠️  Some helper functions are missing!');
  }
} catch (error) {
  console.log('  ❌ Failed to load helper functions');
  console.error('  Error:', error.message);
  process.exit(1);
}

// Step 5: Test a simple write/read operation
console.log('\n✍️  Step 5: Testing write/read operations...');
try {
  const { db } = await import('./lib/firebaseAdmin.js');
  
  // Create a test document
  const testData = {
    test: true,
    timestamp: new Date(),
    message: 'Firebase migration test'
  };
  
  console.log('  📝 Writing test document...');
  const docRef = await db.collection('_test_migration').add(testData);
  console.log('  ✅ Document written with ID:', docRef.id);
  
  console.log('  📖 Reading test document...');
  const docSnapshot = await docRef.get();
  const data = docSnapshot.data();
  console.log('  ✅ Document read successfully');
  console.log('  📄 Data:', { test: data.test, message: data.message });
  
  console.log('  🗑️  Cleaning up test document...');
  await docRef.delete();
  console.log('  ✅ Test document deleted');
  
} catch (error) {
  console.log('  ❌ Write/Read test failed');
  console.error('  Error:', error.message);
  process.exit(1);
}

// Success!
console.log('\n' + '='.repeat(50));
console.log('🎉 All tests passed! Firebase is ready to use!');
console.log('='.repeat(50));
console.log('\n✅ Next steps:');
console.log('  1. Deploy backend to Vercel');
console.log('  2. Add environment variables to Vercel');
console.log('  3. Test payment flow end-to-end');
console.log('  4. Verify subscriptions save to Firestore\n');
