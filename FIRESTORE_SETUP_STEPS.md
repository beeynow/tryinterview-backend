# ⚠️ CRITICAL: Firestore Setup Required

## Current Issue
```
UNAUTHENTICATED: Request had invalid authentication credentials
```

This means **one of these is missing:**

1. ❌ Firestore API is not enabled in Google Cloud
2. ❌ Service account lacks IAM permissions
3. ❌ Cloud Firestore API is not enabled

---

## ✅ SOLUTION: Complete These 3 Steps

### Step 1: Enable Firestore API in Google Cloud

**Click this link to enable Firestore API:**
```
https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=test-590a3
```

1. Click the **"ENABLE"** button
2. Wait for it to complete (takes 10-30 seconds)

---

### Step 2: Create Firestore Database

**Click this link to create Firestore database:**
```
https://console.firebase.google.com/project/test-590a3/firestore
```

1. Click **"Create database"**
2. Choose **"Start in test mode"** (for development)
3. Select region: **us-central1** (or your preferred region)
4. Click **"Enable"**
5. Wait for database creation (takes 1-2 minutes)

---

### Step 3: Add IAM Permissions to Service Account

**Click this link to add permissions:**
```
https://console.cloud.google.com/iam-admin/iam?project=test-590a3
```

1. Find this service account:
   ```
   firebase-adminsdk-fbsvc@test-590a3.iam.gserviceaccount.com
   ```

2. Click the **pencil/edit icon** (✏️) next to it

3. Click **"+ ADD ANOTHER ROLE"**

4. Add these roles:
   - **Cloud Datastore User**
   - **Firebase Admin SDK Administrator Service Agent**
   
   OR for quick testing, just add:
   - **Editor** (gives full access)

5. Click **"SAVE"**

---

## 🧪 Test After Setup

Once you've completed all 3 steps above, run this command:

```bash
cd tryinterview-backend
node << 'EOF'
require('dotenv').config();
const { db } = require('./lib/firebaseAdmin.js');

(async () => {
  try {
    await db.collection('_test').doc('test').set({ message: 'It works!' });
    const doc = await db.collection('_test').doc('test').get();
    console.log('✅ SUCCESS! Firestore is working:', doc.data());
    await db.collection('_test').doc('test').delete();
  } catch (err) {
    console.error('❌ Still failing:', err.message);
  }
})();
EOF
```

---

## 📋 Quick Checklist

- [ ] Firestore API enabled in Google Cloud
- [ ] Firestore database created in Firebase Console
- [ ] Service account has IAM permissions (Editor or Cloud Datastore User)
- [ ] Test script runs successfully

---

## ❓ Still Not Working?

### Check Firestore API Status
```
https://console.cloud.google.com/apis/api/firestore.googleapis.com/metrics?project=test-590a3
```
Should show "API enabled"

### Check Service Account Permissions
```
https://console.cloud.google.com/iam-admin/iam?project=test-590a3
```
Find your service account and verify it has at least one of:
- Editor
- Cloud Datastore User
- Firebase Admin SDK Administrator Service Agent

### Check Firestore Database Exists
```
https://console.firebase.google.com/project/test-590a3/firestore
```
Should show your database with collections (or empty if new)

---

## 🚀 After It Works

Once Firestore is working, you can:
1. Deploy backend to Vercel
2. Test payment flow
3. See subscriptions saved in Firestore Console

**All backend code is ready** - just needs these Google Cloud permissions! 🎉
