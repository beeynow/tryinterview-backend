const { isDatabaseEnabled, query } = require('./db/client');
const {
  hashOptionalValue,
  hashToken,
} = require('./sessionSecurity');

function canUsePostgresStore() {
  return isDatabaseEnabled();
}

function toJsonb(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.stringify(value);
}

function toDate(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function centsToAmount(amountCents) {
  if (amountCents === null || amountCents === undefined) {
    return null;
  }

  return Number(amountCents) / 100;
}

function amountToCents(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return null;
  }

  return Math.round(Number(amount) * 100);
}

function normalizeJsonValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  return value;
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.firebase_uid,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.display_name,
    photoURL: row.photo_url,
    provider: row.provider,
    onboarded: row.onboarded,
    jobTitle: row.job_title,
    targetRole: row.target_role,
    experience: row.experience,
    country: row.country,
    preferredLanguage: row.preferred_language,
    skills: normalizeJsonValue(row.skills, []),
    goals: row.goals,
    interviewType: row.interview_type,
    availability: normalizeJsonValue(row.availability, {}),
    notifications: normalizeJsonValue(row.notifications, {}),
    customerId: row.customer_id,
    metadata: normalizeJsonValue(row.metadata, {}),
    onboardingCompletedAt: row.onboarding_completed_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubscriptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.firebase_uid,
    customerId: row.stripe_customer_id,
    subscriptionId: row.stripe_subscription_id,
    priceId: row.stripe_price_id,
    planName: row.plan_name,
    status: row.status,
    amount: centsToAmount(row.amount_cents),
    currency: row.currency,
    interval: row.billing_interval,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    rawPayload: normalizeJsonValue(row.raw_payload, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserActivityRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.firebase_uid,
    eventType: row.event_type,
    eventSource: row.event_source,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: normalizeJsonValue(row.payload, {}),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

async function getUserRowByFirebaseUid(firebaseUid) {
  const rows = await query(`
    SELECT *
    FROM app_users
    WHERE firebase_uid = $1
    LIMIT 1
  `, [firebaseUid]);

  return rows[0] || null;
}

async function ensureUserRow(firebaseUid) {
  const existingRow = await getUserRowByFirebaseUid(firebaseUid);
  if (existingRow) {
    return existingRow;
  }

  const createdUser = await upsertUser({ userId: firebaseUid });
  return getUserRowByFirebaseUid(createdUser.userId);
}

async function findUserById(firebaseUid) {
  const row = await getUserRowByFirebaseUid(firebaseUid);
  return mapUserRow(row);
}

async function upsertUser(userData) {
  const existingUser = userData?.userId ? await findUserById(userData.userId) : null;
  const mergedMetadata = {
    ...(existingUser?.metadata || {}),
    ...(hasOwn(userData, 'metadata') && userData.metadata ? userData.metadata : {}),
  };
  const mergedUserData = {
    userId: userData.userId,
    email: hasOwn(userData, 'email') ? (userData.email ?? null) : (existingUser?.email ?? null),
    name: hasOwn(userData, 'name') ? (userData.name ?? null) : (existingUser?.name ?? null),
    photoURL: hasOwn(userData, 'photoURL') ? (userData.photoURL ?? null) : (existingUser?.photoURL ?? null),
    provider: hasOwn(userData, 'provider') ? (userData.provider ?? null) : (existingUser?.provider ?? null),
    emailVerified: hasOwn(userData, 'emailVerified')
      ? Boolean(userData.emailVerified)
      : Boolean(existingUser?.emailVerified),
    onboarded: hasOwn(userData, 'onboarded')
      ? Boolean(userData.onboarded)
      : Boolean(existingUser?.onboarded),
    jobTitle: hasOwn(userData, 'jobTitle') ? (userData.jobTitle ?? null) : (existingUser?.jobTitle ?? null),
    targetRole: hasOwn(userData, 'targetRole') ? (userData.targetRole ?? null) : (existingUser?.targetRole ?? null),
    experience: hasOwn(userData, 'experience') ? (userData.experience ?? null) : (existingUser?.experience ?? null),
    country: hasOwn(userData, 'country') ? (userData.country ?? null) : (existingUser?.country ?? null),
    preferredLanguage: hasOwn(userData, 'preferredLanguage')
      ? (userData.preferredLanguage ?? null)
      : (existingUser?.preferredLanguage ?? null),
    skills: hasOwn(userData, 'skills') ? (userData.skills ?? []) : (existingUser?.skills ?? []),
    goals: hasOwn(userData, 'goals') ? (userData.goals ?? null) : (existingUser?.goals ?? null),
    interviewType: hasOwn(userData, 'interviewType')
      ? (userData.interviewType ?? null)
      : (existingUser?.interviewType ?? null),
    availability: hasOwn(userData, 'availability')
      ? (userData.availability ?? {})
      : (existingUser?.availability ?? {}),
    notifications: hasOwn(userData, 'notifications')
      ? (userData.notifications ?? {})
      : (existingUser?.notifications ?? {}),
    customerId: hasOwn(userData, 'customerId')
      ? (userData.customerId ?? null)
      : (existingUser?.customerId ?? null),
    metadata: mergedMetadata,
    onboardingCompletedAt: hasOwn(userData, 'onboardingCompletedAt')
      ? (toDate(userData.onboardingCompletedAt) ?? null)
      : (toDate(existingUser?.onboardingCompletedAt) ?? null),
    lastLoginAt: hasOwn(userData, 'lastLoginAt')
      ? (toDate(userData.lastLoginAt) ?? null)
      : (toDate(existingUser?.lastLoginAt) ?? null),
  };

  const rows = await query(`
    INSERT INTO app_users (
      firebase_uid,
      email,
      display_name,
      photo_url,
      provider,
      email_verified,
      onboarded,
      job_title,
      target_role,
      experience,
      country,
      preferred_language,
      skills,
      goals,
      interview_type,
      availability,
      notifications,
      customer_id,
      onboarding_completed_at,
      metadata,
      last_login_at
    )
    VALUES (
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      COALESCE($6::boolean, FALSE),
      COALESCE($7::boolean, FALSE),
      $8::text,
      $9::text,
      $10::text,
      $11::text,
      $12::text,
      COALESCE($13::jsonb, '[]'::jsonb),
      $14::text,
      $15::text,
      COALESCE($16::jsonb, '{}'::jsonb),
      COALESCE($17::jsonb, '{}'::jsonb),
      $18::text,
      $19::timestamp,
      COALESCE($20::jsonb, '{}'::jsonb),
      $21::timestamp
    )
    ON CONFLICT (firebase_uid) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      photo_url = EXCLUDED.photo_url,
      provider = EXCLUDED.provider,
      email_verified = EXCLUDED.email_verified,
      onboarded = EXCLUDED.onboarded,
      job_title = EXCLUDED.job_title,
      target_role = EXCLUDED.target_role,
      experience = EXCLUDED.experience,
      country = EXCLUDED.country,
      preferred_language = EXCLUDED.preferred_language,
      skills = EXCLUDED.skills,
      goals = EXCLUDED.goals,
      interview_type = EXCLUDED.interview_type,
      availability = EXCLUDED.availability,
      notifications = EXCLUDED.notifications,
      customer_id = EXCLUDED.customer_id,
      onboarding_completed_at = EXCLUDED.onboarding_completed_at,
      metadata = EXCLUDED.metadata,
      last_login_at = EXCLUDED.last_login_at
    RETURNING *
  `, [
    mergedUserData.userId,
    mergedUserData.email,
    mergedUserData.name,
    mergedUserData.photoURL,
    mergedUserData.provider,
    mergedUserData.emailVerified,
    mergedUserData.onboarded,
    mergedUserData.jobTitle,
    mergedUserData.targetRole,
    mergedUserData.experience,
    mergedUserData.country,
    mergedUserData.preferredLanguage,
    toJsonb(mergedUserData.skills, []),
    mergedUserData.goals,
    mergedUserData.interviewType,
    toJsonb(mergedUserData.availability, {}),
    toJsonb(mergedUserData.notifications, {}),
    mergedUserData.customerId,
    mergedUserData.onboardingCompletedAt,
    toJsonb(mergedUserData.metadata, {}),
    mergedUserData.lastLoginAt,
  ]);

  return mapUserRow(rows[0]);
}

async function updateUserCustomerId(firebaseUid, customerId) {
  return upsertUser({
    userId: firebaseUid,
    customerId,
  });
}

async function findSubscriptionById(subscriptionId) {
  const rows = await query(`
    SELECT s.*, u.firebase_uid
    FROM subscriptions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.stripe_subscription_id = $1
    LIMIT 1
  `, [subscriptionId]);

  return mapSubscriptionRow(rows[0]);
}

async function findActiveSubscription(firebaseUid) {
  const rows = await query(`
    SELECT s.*, u.firebase_uid
    FROM subscriptions s
    JOIN app_users u ON u.id = s.user_id
    WHERE u.firebase_uid = $1
      AND s.status = 'active'
    ORDER BY s.updated_at DESC
    LIMIT 1
  `, [firebaseUid]);

  return mapSubscriptionRow(rows[0]);
}

async function cancelOtherSubscriptions(firebaseUid, exceptSubscriptionId) {
  const userRow = await ensureUserRow(firebaseUid);
  const rows = await query(`
    UPDATE subscriptions
    SET
      status = 'canceled',
      canceled_at = NOW(),
      updated_at = NOW()
    WHERE user_id = $1
      AND status = 'active'
      AND stripe_subscription_id <> $2
    RETURNING id
  `, [userRow.id, exceptSubscriptionId]);

  return rows.length;
}

async function upsertSubscription(subscriptionData) {
  const userRow = await ensureUserRow(subscriptionData.userId);

  if (subscriptionData.status === 'active') {
    await query(`
      UPDATE subscriptions
      SET
        status = 'canceled',
        canceled_at = NOW(),
        updated_at = NOW()
      WHERE user_id = $1
        AND status = 'active'
        AND stripe_subscription_id <> $2
    `, [userRow.id, subscriptionData.subscriptionId]);
  }

  const rows = await query(`
    INSERT INTO subscriptions (
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      plan_name,
      status,
      amount_cents,
      currency,
      billing_interval,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      canceled_at,
      raw_payload
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      COALESCE($12, FALSE),
      $13,
      COALESCE($14::jsonb, '{}'::jsonb)
    )
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
      stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, subscriptions.stripe_price_id),
      plan_name = COALESCE(EXCLUDED.plan_name, subscriptions.plan_name),
      status = COALESCE(EXCLUDED.status, subscriptions.status),
      amount_cents = COALESCE(EXCLUDED.amount_cents, subscriptions.amount_cents),
      currency = COALESCE(EXCLUDED.currency, subscriptions.currency),
      billing_interval = COALESCE(EXCLUDED.billing_interval, subscriptions.billing_interval),
      current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
      current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
      cancel_at_period_end = COALESCE(EXCLUDED.cancel_at_period_end, subscriptions.cancel_at_period_end),
      canceled_at = COALESCE(EXCLUDED.canceled_at, subscriptions.canceled_at),
      raw_payload = subscriptions.raw_payload || COALESCE(EXCLUDED.raw_payload, '{}'::jsonb)
    RETURNING subscriptions.*, $15::text AS firebase_uid
  `, [
    userRow.id,
    subscriptionData.customerId ?? null,
    subscriptionData.subscriptionId,
    subscriptionData.priceId ?? null,
    subscriptionData.planName ?? null,
    subscriptionData.status ?? 'active',
    amountToCents(subscriptionData.amount),
    subscriptionData.currency ?? null,
    subscriptionData.interval ?? null,
    toDate(subscriptionData.currentPeriodStart) ?? null,
    toDate(subscriptionData.currentPeriodEnd) ?? null,
    subscriptionData.cancelAtPeriodEnd ?? false,
    toDate(subscriptionData.canceledAt) ?? null,
    toJsonb(subscriptionData.rawPayload, null),
    userRow.firebase_uid,
  ]);

  return mapSubscriptionRow(rows[0]);
}

async function updateSubscription(subscriptionId, updateData) {
  const existing = await findSubscriptionById(subscriptionId);
  if (!existing) {
    return null;
  }

  return upsertSubscription({
    ...existing,
    ...updateData,
    subscriptionId,
    userId: existing.userId,
    customerId: updateData.customerId ?? existing.customerId,
  });
}

async function registerWebhookEvent({ provider, externalEventId, eventType, payload }) {
  const rows = await query(`
    INSERT INTO billing_webhook_events (
      provider,
      external_event_id,
      event_type,
      payload
    )
    VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb))
    ON CONFLICT (provider, external_event_id) DO NOTHING
    RETURNING id
  `, [
    provider,
    externalEventId,
    eventType,
    toJsonb(payload, null),
  ]);

  return rows.length > 0;
}

async function finalizeWebhookEvent({ provider, externalEventId, status, errorMessage = null }) {
  await query(`
    UPDATE billing_webhook_events
    SET
      status = $3,
      error_message = $4,
      processed_at = NOW()
    WHERE provider = $1
      AND external_event_id = $2
  `, [provider, externalEventId, status, errorMessage]);
}

async function createAuthSession({
  userId,
  sessionToken,
  csrfToken = null,
  firebaseSessionExpiresAt = null,
  expiresAt,
  ipAddress = null,
  userAgent = null,
  metadata = {},
}) {
  const userRow = await ensureUserRow(userId);

  const rows = await query(`
    INSERT INTO auth_sessions (
      user_id,
      session_token_hash,
      csrf_token_hash,
      firebase_session_expires_at,
      expires_at,
      ip_hash,
      user_agent_hash,
      last_seen_at,
      metadata
    )
    VALUES (
      $1,
      $2::text,
      $3::text,
      $4::timestamp,
      $5::timestamp,
      $6::text,
      $7::text,
      NOW(),
      COALESCE($8::jsonb, '{}'::jsonb)
    )
    RETURNING id
  `, [
    userRow.id,
    hashToken(sessionToken),
    hashOptionalValue(csrfToken),
    toDate(firebaseSessionExpiresAt) ?? null,
    toDate(expiresAt),
    hashOptionalValue(ipAddress),
    hashOptionalValue(userAgent),
    toJsonb(metadata, null),
  ]);

  return rows[0]?.id || null;
}

async function findValidAuthSession(sessionToken) {
  const rows = await query(`
    SELECT
      s.id AS session_id,
      s.session_token_hash,
      s.csrf_token_hash,
      s.firebase_session_expires_at,
      s.expires_at,
      s.revoked_at,
      s.last_seen_at,
      s.metadata AS session_metadata,
      s.created_at AS session_created_at,
      s.updated_at AS session_updated_at,
      u.id,
      u.firebase_uid,
      u.email,
      u.email_verified,
      u.display_name,
      u.photo_url,
      u.provider,
      u.onboarded,
      u.job_title,
      u.target_role,
      u.experience,
      u.country,
      u.preferred_language,
      u.skills,
      u.goals,
      u.interview_type,
      u.availability,
      u.notifications,
      u.customer_id,
      u.onboarding_completed_at,
      u.metadata,
      u.last_login_at,
      u.created_at,
      u.updated_at
    FROM auth_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.session_token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
    LIMIT 1
  `, [hashToken(sessionToken)]);

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.session_id,
    userId: row.firebase_uid,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    firebaseSessionExpiresAt: row.firebase_session_expires_at,
    csrfTokenHash: row.csrf_token_hash,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
    metadata: normalizeJsonValue(row.session_metadata, {}),
    createdAt: row.session_created_at,
    updatedAt: row.session_updated_at,
    user: mapUserRow(row),
  };
}

async function touchAuthSession(sessionToken) {
  await query(`
    UPDATE auth_sessions
    SET last_seen_at = NOW()
    WHERE session_token_hash = $1
  `, [hashToken(sessionToken)]);
}

async function revokeAuthSession(sessionToken) {
  await query(`
    UPDATE auth_sessions
    SET revoked_at = NOW()
    WHERE session_token_hash = $1
  `, [hashToken(sessionToken)]);
}

async function revokeAuthSessionByUserId(firebaseUid) {
  const userRow = await getUserRowByFirebaseUid(firebaseUid);
  if (!userRow) {
    return;
  }

  await query(`
    UPDATE auth_sessions
    SET revoked_at = NOW()
    WHERE user_id = $1
      AND revoked_at IS NULL
  `, [userRow.id]);
}

async function createUserActivityEvent(firebaseUid, event = {}) {
  const userRow = await ensureUserRow(firebaseUid);
  const rows = await query(`
    INSERT INTO user_activity_events (
      user_id,
      event_type,
      event_source,
      entity_type,
      entity_id,
      payload,
      occurred_at
    )
    VALUES (
      $1,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      COALESCE($6::jsonb, '{}'::jsonb),
      COALESCE($7::timestamp, NOW())
    )
    RETURNING *, $8::text AS firebase_uid
  `, [
    userRow.id,
    event.eventType,
    event.eventSource ?? 'backend',
    event.entityType ?? null,
    event.entityId ?? null,
    toJsonb(event.payload, {}),
    toDate(event.occurredAt) ?? null,
    userRow.firebase_uid,
  ]);

  return mapUserActivityRow(rows[0] || null);
}

async function updateUserSettings(firebaseUid, settings) {
  const userRow = await ensureUserRow(firebaseUid);

  const rows = await query(`
    INSERT INTO user_settings (
      user_id,
      locale,
      timezone,
      marketing_emails,
      product_updates,
      interview_reminders,
      privacy,
      cookie_consent
    )
    VALUES (
      $1,
      $2::text,
      $3::text,
      COALESCE($4::boolean, FALSE),
      COALESCE($5::boolean, TRUE),
      COALESCE($6::boolean, TRUE),
      COALESCE($7::jsonb, '{}'::jsonb),
      COALESCE($8::jsonb, '{}'::jsonb)
    )
    ON CONFLICT (user_id) DO UPDATE SET
      locale = COALESCE(EXCLUDED.locale, user_settings.locale),
      timezone = COALESCE(EXCLUDED.timezone, user_settings.timezone),
      marketing_emails = COALESCE(EXCLUDED.marketing_emails, user_settings.marketing_emails),
      product_updates = COALESCE(EXCLUDED.product_updates, user_settings.product_updates),
      interview_reminders = COALESCE(EXCLUDED.interview_reminders, user_settings.interview_reminders),
      privacy = user_settings.privacy || COALESCE(EXCLUDED.privacy, '{}'::jsonb),
      cookie_consent = user_settings.cookie_consent || COALESCE(EXCLUDED.cookie_consent, '{}'::jsonb)
    RETURNING *
  `, [
    userRow.id,
    settings.locale ?? null,
    settings.timezone ?? null,
    settings.marketingEmails ?? null,
    settings.productUpdates ?? null,
    settings.interviewReminders ?? null,
    toJsonb(settings.privacy, null),
    toJsonb(settings.cookieConsent, null),
  ]);

  return rows[0] || null;
}

async function createInterview(interview) {
  const userRow = await ensureUserRow(interview.userId);

  const rows = await query(`
    INSERT INTO interviews (
      user_id,
      blueprint_id,
      title,
      role,
      company,
      interview_type,
      difficulty,
      status,
      scheduled_at,
      started_at,
      completed_at,
      duration_seconds,
      overall_score,
      summary,
      transcript,
      media,
      metadata
    )
    VALUES (
      $1::uuid,
      $2::uuid,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      COALESCE($8::text, 'draft'),
      $9::timestamp,
      $10::timestamp,
      $11::timestamp,
      $12::integer,
      $13::integer,
      $14::text,
      COALESCE($15::jsonb, '[]'::jsonb),
      COALESCE($16::jsonb, '{}'::jsonb),
      COALESCE($17::jsonb, '{}'::jsonb)
    )
    RETURNING *
  `, [
    userRow.id,
    interview.blueprintId ?? null,
    interview.title ?? null,
    interview.role ?? null,
    interview.company ?? null,
    interview.interviewType,
    interview.difficulty ?? null,
    interview.status ?? null,
    toDate(interview.scheduledAt) ?? null,
    toDate(interview.startedAt) ?? null,
    toDate(interview.completedAt) ?? null,
    interview.durationSeconds ?? null,
    interview.overallScore ?? null,
    interview.summary ?? null,
    toJsonb(interview.transcript, null),
    toJsonb(interview.media, null),
    toJsonb(interview.metadata, null),
  ]);

  return rows[0] || null;
}

async function saveInterviewFeedback(interviewId, feedback) {
  const rows = await query(`
    INSERT INTO interview_feedback (
      interview_id,
      overall_score,
      communication_score,
      technical_score,
      confidence_score,
      structure_score,
      strengths,
      improvements,
      action_items,
      summary,
      detailed_feedback
    )
    VALUES (
      $1::uuid,
      $2::integer,
      $3::integer,
      $4::integer,
      $5::integer,
      $6::integer,
      COALESCE($7::jsonb, '[]'::jsonb),
      COALESCE($8::jsonb, '[]'::jsonb),
      COALESCE($9::jsonb, '[]'::jsonb),
      $10::text,
      COALESCE($11::jsonb, '{}'::jsonb)
    )
    ON CONFLICT (interview_id) DO UPDATE SET
      overall_score = COALESCE(EXCLUDED.overall_score, interview_feedback.overall_score),
      communication_score = COALESCE(EXCLUDED.communication_score, interview_feedback.communication_score),
      technical_score = COALESCE(EXCLUDED.technical_score, interview_feedback.technical_score),
      confidence_score = COALESCE(EXCLUDED.confidence_score, interview_feedback.confidence_score),
      structure_score = COALESCE(EXCLUDED.structure_score, interview_feedback.structure_score),
      strengths = COALESCE(EXCLUDED.strengths, interview_feedback.strengths),
      improvements = COALESCE(EXCLUDED.improvements, interview_feedback.improvements),
      action_items = COALESCE(EXCLUDED.action_items, interview_feedback.action_items),
      summary = COALESCE(EXCLUDED.summary, interview_feedback.summary),
      detailed_feedback = interview_feedback.detailed_feedback || COALESCE(EXCLUDED.detailed_feedback, '{}'::jsonb)
    RETURNING *
  `, [
    interviewId,
    feedback.overallScore ?? null,
    feedback.communicationScore ?? null,
    feedback.technicalScore ?? null,
    feedback.confidenceScore ?? null,
    feedback.structureScore ?? null,
    toJsonb(feedback.strengths, null),
    toJsonb(feedback.improvements, null),
    toJsonb(feedback.actionItems, null),
    feedback.summary ?? null,
    toJsonb(feedback.detailedFeedback, null),
  ]);

  return rows[0] || null;
}

async function listInterviewHistory(firebaseUid, limit = 20) {
  const rows = await query(`
    SELECT
      i.id,
      i.title,
      i.role,
      i.company,
      i.interview_type,
      i.status,
      i.completed_at,
      i.duration_seconds,
      i.overall_score,
      i.summary,
      f.strengths,
      f.improvements
    FROM interviews i
    JOIN app_users u ON u.id = i.user_id
    LEFT JOIN interview_feedback f ON f.interview_id = i.id
    WHERE u.firebase_uid = $1
    ORDER BY COALESCE(i.completed_at, i.updated_at, i.created_at) DESC
    LIMIT $2::integer
  `, [firebaseUid, limit]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    role: row.role,
    company: row.company,
    interviewType: row.interview_type,
    status: row.status,
    completedAt: row.completed_at,
    durationSeconds: row.duration_seconds,
    overallScore: row.overall_score,
    summary: row.summary,
    strengths: normalizeJsonValue(row.strengths, []),
    improvements: normalizeJsonValue(row.improvements, []),
  }));
}

async function saveResumeAnalysis(firebaseUid, analysis) {
  const userRow = await ensureUserRow(firebaseUid);

  const rows = await query(`
    INSERT INTO resume_analyses (
      user_id,
      resume_upload_id,
      overall_score,
      ats_score,
      strengths,
      improvements,
      keywords,
      report,
      analyzer_version
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      COALESCE($5::jsonb, '[]'::jsonb),
      COALESCE($6::jsonb, '[]'::jsonb),
      COALESCE($7::jsonb, '[]'::jsonb),
      COALESCE($8::jsonb, '{}'::jsonb),
      $9
    )
    RETURNING *
  `, [
    userRow.id,
    analysis.resumeUploadId ?? null,
    analysis.overallScore ?? null,
    analysis.atsScore ?? null,
    toJsonb(analysis.strengths, null),
    toJsonb(analysis.improvements, null),
    toJsonb(analysis.keywords, null),
    toJsonb(analysis.report, null),
    analysis.analyzerVersion ?? null,
  ]);

  await refreshUserProgress(firebaseUid);
  return rows[0] || null;
}

async function issueCertificate(firebaseUid, certificate) {
  const userRow = await ensureUserRow(firebaseUid);

  const rows = await query(`
    INSERT INTO certificates (
      user_id,
      certificate_code,
      certificate_type,
      title,
      description,
      verification_url,
      issued_at,
      expires_at,
      metadata
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      COALESCE($7, NOW()),
      $8,
      COALESCE($9::jsonb, '{}'::jsonb)
    )
    RETURNING *
  `, [
    userRow.id,
    certificate.certificateCode,
    certificate.certificateType,
    certificate.title,
    certificate.description ?? null,
    certificate.verificationUrl ?? null,
    toDate(certificate.issuedAt) ?? null,
    toDate(certificate.expiresAt) ?? null,
    toJsonb(certificate.metadata, null),
  ]);

  await refreshUserProgress(firebaseUid);
  return rows[0] || null;
}

async function grantAchievement(firebaseUid, achievementSlug, progress = 0, evidence = {}) {
  const userRow = await ensureUserRow(firebaseUid);

  const rows = await query(`
    INSERT INTO user_achievements (
      user_id,
      achievement_id,
      progress,
      unlocked_at,
      evidence
    )
    SELECT
      $1,
      ad.id,
      $3,
      CASE WHEN $4 THEN NOW() ELSE NULL END,
      COALESCE($5::jsonb, '{}'::jsonb)
    FROM achievement_definitions ad
    WHERE ad.slug = $2
    ON CONFLICT (user_id, achievement_id) DO UPDATE SET
      progress = GREATEST(user_achievements.progress, EXCLUDED.progress),
      unlocked_at = COALESCE(user_achievements.unlocked_at, EXCLUDED.unlocked_at),
      evidence = user_achievements.evidence || COALESCE(EXCLUDED.evidence, '{}'::jsonb)
    RETURNING *
  `, [
    userRow.id,
    achievementSlug,
    progress,
    Boolean(progress >= 100),
    toJsonb(evidence, null),
  ]);

  await refreshUserProgress(firebaseUid);
  return rows[0] || null;
}

async function refreshUserProgress(firebaseUid) {
  const userRow = await getUserRowByFirebaseUid(firebaseUid);
  if (!userRow) {
    return null;
  }

  await query('SELECT refresh_user_progress_snapshot($1::uuid)', [userRow.id]);

  const rows = await query(`
    SELECT *
    FROM user_progress
    WHERE user_id = $1
    LIMIT 1
  `, [userRow.id]);

  return rows[0] || null;
}

module.exports = {
  canUsePostgresStore,
  createAuthSession,
  createUserActivityEvent,
  createInterview,
  finalizeWebhookEvent,
  findActiveSubscription,
  findSubscriptionById,
  findUserById,
  findValidAuthSession,
  grantAchievement,
  issueCertificate,
  listInterviewHistory,
  refreshUserProgress,
  registerWebhookEvent,
  revokeAuthSession,
  revokeAuthSessionByUserId,
  saveInterviewFeedback,
  saveResumeAnalysis,
  touchAuthSession,
  updateSubscription,
  updateUserCustomerId,
  updateUserSettings,
  upsertSubscription,
  upsertUser,
  cancelOtherSubscriptions,
};
