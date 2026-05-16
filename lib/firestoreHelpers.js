const { getDb } = require('./firebaseAdmin');
const {
  getDatabaseConfigError,
} = require('./db/client');
const {
  canUsePostgresStore,
  cancelOtherSubscriptions: cancelOtherSubscriptionsInPostgres,
  findActiveSubscription: findActiveSubscriptionInPostgres,
  findSubscriptionById: findSubscriptionByIdInPostgres,
  findUserById: findUserByIdInPostgres,
  updateSubscription: updateSubscriptionInPostgres,
  updateUserCustomerId: updateUserCustomerIdInPostgres,
  upsertSubscription: upsertSubscriptionInPostgres,
  upsertUser: upsertUserInPostgres,
} = require('./postgresStore');

function isDatabaseRequired() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.REQUIRE_DATABASE || '').trim().toLowerCase()
  );
}

function assertFallbackAllowed() {
  if (!isDatabaseRequired()) {
    return;
  }

  throw new Error(
    getDatabaseConfigError() || 'Postgres is required for application data, but it is not available.'
  );
}

function timestampToDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp._seconds) return new Date(timestamp._seconds * 1000);
  return timestamp;
}

function serializeDoc(data) {
  if (!data) return null;

  const serialized = { ...data };

  Object.keys(serialized).forEach((key) => {
    const value = serialized[key];
    if (value && typeof value === 'object' && (value.toDate || value._seconds)) {
      serialized[key] = timestampToDate(value);
    }
  });

  return serialized;
}

async function findSubscriptionById(subscriptionId) {
  if (canUsePostgresStore()) {
    return findSubscriptionByIdInPostgres(subscriptionId);
  }

  assertFallbackAllowed();

  const db = getDb();
  const snapshot = await db.collection('subscriptions')
    .where('subscriptionId', '==', subscriptionId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findActiveSubscription(userId) {
  if (canUsePostgresStore()) {
    return findActiveSubscriptionInPostgres(userId);
  }

  assertFallbackAllowed();

  const db = getDb();
  const snapshot = await db.collection('subscriptions')
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function cancelOtherSubscriptions(userId, exceptSubscriptionId) {
  if (canUsePostgresStore()) {
    return cancelOtherSubscriptionsInPostgres(userId, exceptSubscriptionId);
  }

  assertFallbackAllowed();

  const db = getDb();
  const snapshot = await db.collection('subscriptions')
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .get();

  const batch = db.batch();
  let count = 0;

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.subscriptionId !== exceptSubscriptionId) {
      batch.update(doc.ref, {
        status: 'canceled',
        canceledAt: new Date(),
        updatedAt: new Date(),
      });
      count += 1;
    }
  });

  if (count > 0) {
    await batch.commit();
  }

  return count;
}

async function upsertSubscription(subscriptionData) {
  if (canUsePostgresStore()) {
    return upsertSubscriptionInPostgres(subscriptionData);
  }

  assertFallbackAllowed();

  const db = getDb();
  const { subscriptionId } = subscriptionData;
  const snapshot = await db.collection('subscriptions')
    .where('subscriptionId', '==', subscriptionId)
    .limit(1)
    .get();

  const timestamp = new Date();

  if (snapshot.empty) {
    const docRef = await db.collection('subscriptions').add({
      ...subscriptionData,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { id: docRef.id, ...subscriptionData, createdAt: timestamp, updatedAt: timestamp };
  }

  const doc = snapshot.docs[0];
  await doc.ref.update({
    ...subscriptionData,
    updatedAt: timestamp,
  });
  return { id: doc.id, ...subscriptionData, updatedAt: timestamp };
}

async function updateSubscription(subscriptionId, updateData) {
  if (canUsePostgresStore()) {
    return updateSubscriptionInPostgres(subscriptionId, updateData);
  }

  assertFallbackAllowed();

  const db = getDb();
  const snapshot = await db.collection('subscriptions')
    .where('subscriptionId', '==', subscriptionId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  await doc.ref.update({
    ...updateData,
    updatedAt: new Date(),
  });

  return { id: doc.id, ...doc.data(), ...updateData };
}

async function findUserById(userId) {
  if (canUsePostgresStore()) {
    return findUserByIdInPostgres(userId);
  }

  assertFallbackAllowed();

  const db = getDb();
  const snapshot = await db.collection('users')
    .where('userId', '==', userId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function upsertUser(userData) {
  if (canUsePostgresStore()) {
    return upsertUserInPostgres(userData);
  }

  assertFallbackAllowed();

  const db = getDb();
  const { userId } = userData;
  const snapshot = await db.collection('users')
    .where('userId', '==', userId)
    .limit(1)
    .get();

  const timestamp = new Date();

  if (snapshot.empty) {
    const docRef = await db.collection('users').add({
      ...userData,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { id: docRef.id, ...userData, createdAt: timestamp, updatedAt: timestamp };
  }

  const doc = snapshot.docs[0];
  await doc.ref.update({
    ...userData,
    updatedAt: timestamp,
  });
  return { id: doc.id, ...userData, updatedAt: timestamp };
}

async function updateUserCustomerId(userId, customerId) {
  if (canUsePostgresStore()) {
    return updateUserCustomerIdInPostgres(userId, customerId);
  }

  assertFallbackAllowed();

  const db = getDb();
  const snapshot = await db.collection('users')
    .where('userId', '==', userId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return upsertUser({ userId, customerId });
  }

  const doc = snapshot.docs[0];
  await doc.ref.update({
    customerId,
    updatedAt: new Date(),
  });

  return { id: doc.id, userId, customerId };
}

module.exports = {
  cancelOtherSubscriptions,
  findActiveSubscription,
  findSubscriptionById,
  findUserById,
  serializeDoc,
  timestampToDate,
  updateSubscription,
  updateUserCustomerId,
  upsertSubscription,
  upsertUser,
};
