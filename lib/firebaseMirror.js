const { getDb } = require('./firebaseAdmin');

function getMirrorDb() {
  try {
    return getDb();
  } catch (error) {
    console.warn('Firebase mirror is unavailable:', error.message);
    return null;
  }
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function stripUndefined(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value).reduce((accumulator, [key, itemValue]) => {
      const normalizedValue = stripUndefined(itemValue);

      if (normalizedValue !== undefined) {
        accumulator[key] = normalizedValue;
      }

      return accumulator;
    }, {});

    return normalizedEntries;
  }

  return value;
}

function buildMirrorSummary(snapshot = {}) {
  const progress = snapshot.progress || {};
  const achievements = Array.isArray(snapshot.achievements) ? snapshot.achievements : [];
  const certificates = Array.isArray(snapshot.certificates) ? snapshot.certificates : [];
  const resumeAnalyses = Array.isArray(snapshot.resumeAnalyses) ? snapshot.resumeAnalyses : [];
  const interviews = snapshot.interviews?.recent || snapshot.interviews || [];

  return {
    achievementsUnlocked: progress.achievementsUnlocked ?? achievements.filter((item) => item?.unlocked).length,
    certificatesEarned: progress.certificatesEarned ?? certificates.length,
    interviewsCompleted: progress.interviewsCompleted ?? interviews.length,
    resumeAnalysesCompleted: progress.resumeAnalysesCompleted ?? resumeAnalyses.length,
    averageScore: progress.averageScore ?? null,
    currentStreak: progress.currentStreak ?? null,
    longestStreak: progress.longestStreak ?? null,
    lastActivityAt: normalizeTimestamp(progress.lastActivityAt),
  };
}

async function mirrorUserSnapshot(firebaseUid, snapshot = {}) {
  const db = getMirrorDb();

  if (!db || !firebaseUid) {
    return false;
  }

  const docRef = db.collection('platform_users').doc(firebaseUid);
  const profile = snapshot.profile || snapshot.user || null;
  const payload = stripUndefined({
    userId: firebaseUid,
    identity: profile ? {
      email: profile.email || null,
      provider: profile.provider || null,
      photoURL: profile.photoURL || null,
      displayName: profile.name || null,
    } : undefined,
    profile,
    settings: snapshot.settings,
    subscription: snapshot.subscription,
    progress: snapshot.progress,
    summary: buildMirrorSummary(snapshot),
    source: 'postgres',
    updatedAt: new Date(),
  });

  await docRef.set(payload, { merge: true });
  return true;
}

async function mirrorUserActivity(firebaseUid, activity = {}) {
  const db = getMirrorDb();

  if (!db || !firebaseUid) {
    return false;
  }

  const docRef = db.collection('platform_users').doc(firebaseUid);
  const activityRef = docRef.collection('activity').doc();
  const occurredAt = normalizeTimestamp(activity.occurredAt) || new Date();
  const payload = stripUndefined({
    id: activity.id || activityRef.id,
    userId: firebaseUid,
    eventType: activity.eventType,
    eventSource: activity.eventSource || 'backend',
    entityType: activity.entityType || null,
    entityId: activity.entityId || null,
    payload: activity.payload || {},
    occurredAt,
    createdAt: new Date(),
  });

  await activityRef.set(payload);
  await docRef.set({
    lastActivityAt: occurredAt,
    lastActivityType: activity.eventType || null,
    updatedAt: new Date(),
  }, { merge: true });

  return true;
}

module.exports = {
  mirrorUserActivity,
  mirrorUserSnapshot,
};
