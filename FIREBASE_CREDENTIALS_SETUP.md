# Firebase Credentials Setup - Step by Step

## Current Status
✅ Backend code migrated to Firestore  
✅ Firebase Admin SDK installed  
⚠️ Credentials need to be regenerated (current key has authentication error)

---

## Step-by-Step Instructions

### 1. Go to Firebase Console
Open: https://console.firebase.google.com/project/test-590a3

### 2. Enable Firestore Database
1. In left sidebar, click **"Firestore Database"**
2. If not already enabled, click **"Create Database"**
3. Choose **"Start in test mode"** (we'll update security rules later)
4. Select a region (e.g., `us-central1`)
5. Click **"Enable"**

### 3. Generate NEW Service Account Key
1. Click the **⚙️ gear icon** (top left) → **"Project settings"**
2. Go to **"Service accounts"** tab
3. Click **"Generate new private key"** button
4. Click **"Generate key"** in the confirmation dialog
5. A JSON file will download - **save it securely!**

### 4. Update Environment Variables

Open the downloaded JSON file. It should look like this:
```json
{
  "type": "service_account",
  "project_id": "test-590a3",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@test-590a3.iam.gserviceaccount.com",
  ...
}
```

#### For Local Development:
Update `tryinterview-backend/.env`:
```bash
FIREBASE_PROJECT_ID=test-590a3
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...(paste the full private_key value here)...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@test-590a3.iam.gserviceaccount.com
```

**Important:** 
- Keep the quotes around `FIREBASE_PRIVATE_KEY`
- Keep the literal `\n` characters (don't replace with actual newlines)
- Copy the EXACT value from the JSON file

#### For Vercel Deployment:
1. Go to your Vercel project settings
2. Go to **Environment Variables**
3. Add these three variables:
   ```
   FIREBASE_PROJECT_ID = test-590a3
   FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL = firebase-adminsdk-xxxxx@test-590a3.iam.gserviceaccount.com
   ```
4. Select **Production**, **Preview**, and **Development** for all three
5. Click **"Save"**

### 5. Test the Connection

Run this command to verify Firebase is working:
```bash
cd tryinterview-backend
node test-firebase.js
```

You should see:
```
✅ Firebase Admin initialized with individual credentials
✅ Firestore connected! Collections found: 0
🎉 Firebase is ready to use!
```

---

## Firestore Security Rules

After testing, update your Firestore security rules for production:

1. In Firebase Console → Firestore Database → **Rules** tab
2. Replace with:

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

3. Click **"Publish"**

---

## Troubleshooting

### Error: "UNAUTHENTICATED"
- The service account key is expired or disabled
- Solution: Generate a new key (step 3 above)

### Error: "Permission denied"
- Firestore security rules are blocking access
- Solution: Update rules (see above)

### Error: "Firestore API not enabled"
- Firestore is not enabled in your project
- Solution: Enable it (step 2 above)

### Error: "Invalid private key format"
- The private key wasn't copied correctly
- Solution: Make sure to copy the EXACT value including quotes and `\n` characters

---

## What's Next After Setup

Once Firebase is working:

1. ✅ Test payment flow end-to-end
2. ✅ Verify subscriptions save to Firestore
3. ✅ Deploy backend to Vercel
4. ✅ Test webhook integration
5. ✅ Verify dashboard shows active plan

---

**Need help?** Check the main `FIREBASE_SETUP.md` for more details.
