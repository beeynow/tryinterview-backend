# Firebase Setup Guide

## Overview
This backend now uses **Firebase Firestore** instead of MongoDB for all data storage (users and subscriptions).

## Setup Instructions

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable **Firestore Database** in your project

### 2. Get Firebase Admin Credentials

#### Option A: For Vercel Deployment (Recommended)
1. In Firebase Console, go to **Project Settings** > **Service Accounts**
2. Click **Generate New Private Key** and download the JSON file
3. Extract these values from the JSON:
   - `project_id`
   - `private_key`
   - `client_email`

4. Add to Vercel Environment Variables:
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
   ```

   **Important**: The `FIREBASE_PRIVATE_KEY` must include the literal `\n` characters (not actual newlines). Copy it exactly as it appears in the JSON file.

#### Option B: For Local Development (JSON String)
Add the entire service account JSON as a single environment variable:
```
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
```

#### Option C: For Local Development (File Path)
Download the service account key JSON file and save it as `serviceAccountKey.json` in the backend root, then:
```
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
```

**⚠️ NEVER commit the serviceAccountKey.json file to git!** It's already in `.gitignore`.

### 3. Firestore Collections Structure

The app uses two collections:

#### `users` collection
```javascript
{
  userId: string,          // Firebase Auth UID
  email: string,
  name: string,
  photoURL: string,
  provider: string,
  customerId: string,      // Stripe customer ID
  onboarded: boolean,
  jobTitle: string,
  experience: string,
  skills: array,
  goals: array,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastLoginAt: timestamp
}
```

#### `subscriptions` collection
```javascript
{
  userId: string,          // Firebase Auth UID
  customerId: string,      // Stripe customer ID
  subscriptionId: string,  // Stripe subscription ID
  priceId: string,         // Stripe price ID
  planName: string,        // "Starter", "Professional", "Premium", "Enterprise"
  status: string,          // "active", "canceled", etc.
  amount: number,          // Price in dollars
  currency: string,        // "USD"
  interval: string,        // "month"
  currentPeriodStart: timestamp,
  currentPeriodEnd: timestamp,
  cancelAtPeriodEnd: boolean,
  canceledAt: timestamp,   // only if canceled
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 4. Firestore Indexes (Optional but Recommended)

For better query performance, create these composite indexes:

1. **subscriptions**:
   - `userId` (Ascending) + `status` (Ascending) + `createdAt` (Descending)

To create indexes:
1. Go to Firestore Console > Indexes
2. Click "Create Index"
3. Add the fields above

### 5. Security Rules

Update your Firestore security rules to protect your data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection - users can only read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Subscriptions collection - users can only read their own subscriptions
    // Backend (Firebase Admin SDK) can write via service account
    match /subscriptions/{subscriptionId} {
      allow read: if request.auth != null && 
                    resource.data.userId == request.auth.uid;
      allow write: if false; // Only backend can write
    }
  }
}
```

## Testing the Migration

1. **Verify environment variables are set** (see `.env.example`)
2. **Test the API endpoints**:
   - `POST /api/create-checkout-session` - Creates Stripe checkout
   - `GET /api/check-subscription?userId=xxx` - Checks user subscription from Firestore
   - `POST /api/webhook` - Stripe webhook saves to Firestore
   - `POST /api/verify-payment?session_id=xxx&userId=xxx` - Verifies payment and saves to Firestore
   - `GET /api/user-profile?userId=xxx` - Gets user profile from Firestore
   - `POST /api/user-profile?userId=xxx` - Saves user profile to Firestore

3. **Monitor Firestore Console** to see documents being created

## Migrating Existing MongoDB Data (Optional)

If you have existing MongoDB data, you'll need to export it and import to Firestore:

1. Export from MongoDB (use `mongoexport` or MongoDB Compass)
2. Transform the data format (remove `_id`, convert dates to Firestore Timestamps)
3. Import to Firestore using Firebase Admin SDK or Firebase CLI

## Troubleshooting

### Error: "Failed to initialize Firebase Admin"
- Check that your environment variables are set correctly
- Verify the private key includes `\n` characters (for Vercel)
- Ensure the service account JSON is valid

### Error: "Permission denied" in Firestore
- Check your Firestore security rules
- Verify the service account has proper permissions

### Subscription not showing in frontend
- Check Firestore Console to verify the document was created
- Verify `userId` matches between Firebase Auth and Firestore
- Check browser console for API errors

## Benefits of Firestore over MongoDB

✅ **No connection management** - Serverless, auto-scales  
✅ **Real-time updates** - Can add live sync in future  
✅ **Better Vercel integration** - No cold start connection issues  
✅ **Free tier** - 50K reads, 20K writes per day  
✅ **Built-in Firebase integration** - Works seamlessly with Firebase Auth  
✅ **Automatic backups** - Point-in-time recovery available  

---

**Questions?** Check the [Firebase Firestore Documentation](https://firebase.google.com/docs/firestore)
