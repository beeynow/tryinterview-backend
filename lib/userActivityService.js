const {
  canUsePostgresStore,
  createUserActivityEvent,
} = require('./postgresStore');
const {
  mirrorUserActivity,
  mirrorUserSnapshot,
} = require('./firebaseMirror');

async function syncUserMirror(firebaseUid, snapshot = {}) {
  try {
    await mirrorUserSnapshot(firebaseUid, snapshot);
  } catch (error) {
    console.warn(`Failed to mirror user snapshot for ${firebaseUid}:`, error.message);
  }
}

async function recordUserActivity(firebaseUid, event = {}, { snapshot = null } = {}) {
  let savedEvent = null;

  if (canUsePostgresStore()) {
    try {
      savedEvent = await createUserActivityEvent(firebaseUid, event);
    } catch (error) {
      console.error(`Failed to persist user activity for ${firebaseUid}:`, error);
    }
  }

  try {
    await mirrorUserActivity(firebaseUid, {
      ...event,
      id: savedEvent?.id || null,
      occurredAt: savedEvent?.occurredAt || event.occurredAt || new Date(),
    });
  } catch (error) {
    console.warn(`Failed to mirror user activity for ${firebaseUid}:`, error.message);
  }

  if (snapshot) {
    await syncUserMirror(firebaseUid, snapshot);
  }

  return savedEvent;
}

module.exports = {
  recordUserActivity,
  syncUserMirror,
};
