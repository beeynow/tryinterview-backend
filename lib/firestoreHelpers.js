const { db } = require('./firebaseAdmin');

// ============================================
// SUBSCRIPTION OPERATIONS
// ============================================

/**
 * Find subscription by subscriptionId
 */
async function findSubscriptionById(subscriptionId) {
  try {
    const snapshot = await db.collection('subscriptions')
      .where('subscriptionId', '==', subscriptionId)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error finding subscription:', error);
    throw error;
  }
}

/**
 * Find active subscription by userId
 */
async function findActiveSubscription(userId) {
  try {
    const snapshot = await db.collection('subscriptions')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error finding active subscription:', error);
    throw error;
  }
}

/**
 * Cancel all active subscriptions for a user except one
 */
async function cancelOtherSubscriptions(userId, exceptSubscriptionId) {
  try {
    const snapshot = await db.collection('subscriptions')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();
    
    const batch = db.batch();
    let count = 0;
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.subscriptionId !== exceptSubscriptionId) {
        batch.update(doc.ref, {
          status: 'canceled',
          canceledAt: new Date(),
          updatedAt: new Date()
        });
        count++;
      }
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`✅ Canceled ${count} old subscription(s) for user ${userId}`);
    }
    
    return count;
  } catch (error) {
    console.error('Error canceling subscriptions:', error);
    throw error;
  }
}

/**
 * Upsert subscription (create or update)
 */
async function upsertSubscription(subscriptionData) {
  try {
    const { subscriptionId } = subscriptionData;
    
    // Find existing document
    const snapshot = await db.collection('subscriptions')
      .where('subscriptionId', '==', subscriptionId)
      .limit(1)
      .get();
    
    const timestamp = new Date();
    
    if (snapshot.empty) {
      // Create new document
      const docRef = await db.collection('subscriptions').add({
        ...subscriptionData,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      console.log('✅ Subscription created:', docRef.id);
      return { id: docRef.id, ...subscriptionData, createdAt: timestamp, updatedAt: timestamp };
    } else {
      // Update existing document
      const doc = snapshot.docs[0];
      await doc.ref.update({
        ...subscriptionData,
        updatedAt: timestamp
      });
      console.log('✅ Subscription updated:', doc.id);
      return { id: doc.id, ...subscriptionData, updatedAt: timestamp };
    }
  } catch (error) {
    console.error('Error upserting subscription:', error);
    throw error;
  }
}

/**
 * Update subscription by subscriptionId
 */
async function updateSubscription(subscriptionId, updateData) {
  try {
    const snapshot = await db.collection('subscriptions')
      .where('subscriptionId', '==', subscriptionId)
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      console.warn(`⚠️ Subscription ${subscriptionId} not found for update`);
      return null;
    }
    
    const doc = snapshot.docs[0];
    await doc.ref.update({
      ...updateData,
      updatedAt: new Date()
    });
    
    console.log('✅ Subscription updated:', doc.id);
    return { id: doc.id, ...doc.data(), ...updateData };
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

// ============================================
// USER OPERATIONS
// ============================================

/**
 * Find user by userId (Firebase UID)
 */
async function findUserById(userId) {
  try {
    const snapshot = await db.collection('users')
      .where('userId', '==', userId)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error finding user:', error);
    throw error;
  }
}

/**
 * Upsert user (create or update)
 */
async function upsertUser(userData) {
  try {
    const { userId } = userData;
    
    // Find existing document
    const snapshot = await db.collection('users')
      .where('userId', '==', userId)
      .limit(1)
      .get();
    
    const timestamp = new Date();
    
    if (snapshot.empty) {
      // Create new document
      const docRef = await db.collection('users').add({
        ...userData,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      console.log('✅ User created:', docRef.id);
      return { id: docRef.id, ...userData, createdAt: timestamp, updatedAt: timestamp };
    } else {
      // Update existing document
      const doc = snapshot.docs[0];
      await doc.ref.update({
        ...userData,
        updatedAt: timestamp
      });
      console.log('✅ User updated:', doc.id);
      return { id: doc.id, ...userData, updatedAt: timestamp };
    }
  } catch (error) {
    console.error('Error upserting user:', error);
    throw error;
  }
}

/**
 * Update user customerId
 */
async function updateUserCustomerId(userId, customerId) {
  try {
    const snapshot = await db.collection('users')
      .where('userId', '==', userId)
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      // Create new user with customerId
      return await upsertUser({ userId, customerId });
    }
    
    const doc = snapshot.docs[0];
    await doc.ref.update({
      customerId,
      updatedAt: new Date()
    });
    
    console.log('✅ User customerId updated:', doc.id);
    return { id: doc.id, userId, customerId };
  } catch (error) {
    console.error('Error updating user customerId:', error);
    throw error;
  }
}

// ============================================
// HELPER UTILITIES
// ============================================

/**
 * Convert Firestore Timestamp to JavaScript Date
 */
function timestampToDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp._seconds) return new Date(timestamp._seconds * 1000);
  return timestamp;
}

/**
 * Serialize Firestore document data (convert Timestamps to ISO strings)
 */
function serializeDoc(data) {
  if (!data) return null;
  
  const serialized = { ...data };
  
  Object.keys(serialized).forEach(key => {
    const value = serialized[key];
    if (value && typeof value === 'object' && (value.toDate || value._seconds)) {
      serialized[key] = timestampToDate(value);
    }
  });
  
  return serialized;
}

// Export all functions
module.exports = {
  findSubscriptionById,
  findActiveSubscription,
  cancelOtherSubscriptions,
  upsertSubscription,
  updateSubscription,
  findUserById,
  upsertUser,
  updateUserCustomerId,
  timestampToDate,
  serializeDoc
};
