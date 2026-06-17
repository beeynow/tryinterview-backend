const crypto = require('crypto');
const { query } = require('./db/client');
const { buildEntitlements } = require('./planConfig');
const {
  canUsePostgresStore,
  createInterview,
  findActiveSubscription,
  findUserById,
  grantAchievement,
  issueCertificate,
  listInterviewHistory,
  refreshUserProgress,
  saveInterviewFeedback,
  saveResumeAnalysis,
  updateUserSettings,
  upsertUser,
} = require('./postgresStore');
const {
  recordUserActivity,
  syncUserMirror,
} = require('./userActivityService');

const DEFAULT_FRONTEND_URL = 'https://www.tryinterviews.site';
const DEFAULT_SETTINGS = {
  locale: 'en-US',
  timezone: 'UTC',
  marketingEmails: false,
  productUpdates: true,
  interviewReminders: true,
  privacy: {
    profileVisibility: 'private',
    shareCertificates: true,
  },
  cookieConsent: {
    essential: true,
    analytics: false,
  },
};
const SUPPORTED_PROFILE_INTERVIEW_TYPES = new Set([
  'behavioral',
  'technical',
  'leadership',
  'situational',
]);

const QUESTION_BANK_SEED = [
  {
    slug: 'behavioral',
    name: 'Behavioral',
    description: 'Behavioral and STAR-based interview practice.',
    items: [
      {
        role: 'Software Engineer',
        company: 'Growth Startup',
        interviewType: 'behavioral',
        difficulty: 'Medium',
        questionText: 'Tell me about a time you had to rebuild trust after a project setback.',
        sampleAnswer: 'Explain the setback, how you owned the recovery plan, and the measurable outcome after rebuilding alignment.',
        tags: ['star', 'communication', 'ownership'],
      },
      {
        role: 'Product Manager',
        company: 'B2B SaaS',
        interviewType: 'behavioral',
        difficulty: 'Hard',
        questionText: 'Describe a disagreement with engineering and how you aligned everyone around a decision.',
        sampleAnswer: 'Focus on tradeoffs, decision framing, and the evidence you used to move the team toward a shared choice.',
        tags: ['stakeholder-management', 'leadership'],
      },
      {
        role: 'Customer Success Manager',
        company: 'Enterprise Platform',
        interviewType: 'behavioral',
        difficulty: 'Easy',
        questionText: 'Share a time you turned around an unhappy customer relationship.',
        sampleAnswer: 'Show empathy, structured diagnosis, and the concrete retention or expansion result.',
        tags: ['customer-success', 'empathy'],
      },
    ],
  },
  {
    slug: 'technical',
    name: 'Technical',
    description: 'Technical interviews across engineering and systems thinking.',
    items: [
      {
        role: 'Frontend Engineer',
        company: 'Remote SaaS',
        interviewType: 'technical',
        difficulty: 'Medium',
        questionText: 'How would you improve a React dashboard that feels slow when switching tabs?',
        sampleAnswer: 'Discuss profiling, render boundaries, data fetching strategy, code-splitting, and prioritizing perceived performance.',
        tags: ['react', 'performance', 'frontend'],
      },
      {
        role: 'Backend Engineer',
        company: 'Fintech',
        interviewType: 'technical',
        difficulty: 'Hard',
        questionText: 'Design an idempotent webhook processing system for subscription billing events.',
        sampleAnswer: 'Cover signatures, deduplication keys, retry safety, persistence, observability, and failure recovery.',
        tags: ['system-design', 'backend', 'payments'],
      },
      {
        role: 'Data Analyst',
        company: 'Marketplace',
        interviewType: 'technical',
        difficulty: 'Easy',
        questionText: 'What metrics would you use to evaluate a funnel drop after a new product launch?',
        sampleAnswer: 'Start with leading indicators, segment by user cohort, compare baselines, and isolate instrumentation changes.',
        tags: ['analytics', 'sql', 'metrics'],
      },
    ],
  },
  {
    slug: 'leadership',
    name: 'Leadership',
    description: 'Leadership and people-management interview practice.',
    items: [
      {
        role: 'Engineering Manager',
        company: 'Scale-up',
        interviewType: 'leadership',
        difficulty: 'Hard',
        questionText: 'How do you balance delivery pressure with team health during a demanding quarter?',
        sampleAnswer: 'Explain prioritization, risk framing, communication cadence, and how you protect sustainable execution.',
        tags: ['leadership', 'team-health'],
      },
      {
        role: 'Director of Operations',
        company: 'Logistics',
        interviewType: 'leadership',
        difficulty: 'Medium',
        questionText: 'Tell me about a time you had to reset expectations with executives.',
        sampleAnswer: 'Frame the decision, the data that changed the plan, and how you rebuilt confidence through transparency.',
        tags: ['executive-communication', 'operations'],
      },
      {
        role: 'Team Lead',
        company: 'Agency',
        interviewType: 'leadership',
        difficulty: 'Medium',
        questionText: 'Describe how you coach someone who is underperforming but highly motivated.',
        sampleAnswer: 'Discuss diagnosis, clarity, support, and how you measure progress fairly over time.',
        tags: ['coaching', 'management'],
      },
    ],
  },
  {
    slug: 'situational',
    name: 'Situational',
    description: 'Scenario-based questions for decision making under pressure.',
    items: [
      {
        role: 'Product Designer',
        company: 'Consumer App',
        interviewType: 'situational',
        difficulty: 'Medium',
        questionText: 'What would you do if user research contradicts a high-priority stakeholder request?',
        sampleAnswer: 'Show how you validate both perspectives, propose an experiment, and align on learning goals.',
        tags: ['design', 'stakeholder-management'],
      },
      {
        role: 'DevOps Engineer',
        company: 'Cloud Platform',
        interviewType: 'situational',
        difficulty: 'Hard',
        questionText: 'How would you respond if a release caused a customer-facing outage during peak traffic?',
        sampleAnswer: 'Prioritize mitigation, communication, rollback criteria, and a blameless post-incident review.',
        tags: ['incident-response', 'devops'],
      },
      {
        role: 'Marketing Manager',
        company: 'Ecommerce',
        interviewType: 'situational',
        difficulty: 'Easy',
        questionText: 'What would you do if a campaign misses its launch deadline by one week?',
        sampleAnswer: 'Explain how you reassess channels, re-forecast impact, and keep stakeholders informed with options.',
        tags: ['marketing', 'execution'],
      },
    ],
  },
  {
    slug: 'industry',
    name: 'Industry-Specific',
    description: 'Role and industry targeted interview questions.',
    items: [
      {
        role: 'AI Product Manager',
        company: 'Applied AI',
        interviewType: 'industry',
        difficulty: 'Hard',
        questionText: 'How would you evaluate whether an AI feature is delivering trustworthy value to users?',
        sampleAnswer: 'Talk about quality metrics, human review, safety controls, and the business outcome tied to adoption.',
        tags: ['ai', 'product'],
      },
      {
        role: 'Cybersecurity Analyst',
        company: 'Security Firm',
        interviewType: 'industry',
        difficulty: 'Medium',
        questionText: 'What is your process for prioritizing vulnerabilities after a new security scan?',
        sampleAnswer: 'Show a risk-based approach using exploitability, asset criticality, and remediation constraints.',
        tags: ['security', 'risk'],
      },
      {
        role: 'Healthcare Operations Lead',
        company: 'HealthTech',
        interviewType: 'industry',
        difficulty: 'Medium',
        questionText: 'How would you improve patient support response times without lowering quality?',
        sampleAnswer: 'Describe process bottlenecks, staffing models, triage logic, and quality monitoring.',
        tags: ['healthcare', 'operations'],
      },
    ],
  },
];

function ensurePostgresEnabled() {
  if (!canUsePostgresStore()) {
    const error = new Error('Postgres is not configured for platform data.');
    error.statusCode = 503;
    throw error;
  }
}

function toJsonb(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.stringify(value);
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

function normalizeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeOptionalText(value, { maxLength = 160 } = {}) {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalizedValue) {
    return null;
  }

  return normalizedValue.slice(0, maxLength);
}

function normalizeStringArray(value, { maxItems = 12, maxItemLength = 64 } = {}) {
  if (value === undefined) {
    return undefined;
  }

  const sourceItems = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  const uniqueItems = [];

  sourceItems.forEach((item) => {
    const normalizedItem = String(item ?? '').trim();

    if (!normalizedItem) {
      return;
    }

    const finalItem = normalizedItem.slice(0, maxItemLength);
    if (!uniqueItems.includes(finalItem)) {
      uniqueItems.push(finalItem);
    }
  });

  return uniqueItems.slice(0, maxItems);
}

function normalizeProfileInterviewType(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  const aliases = {
    'technical interviews': 'technical',
    'behavioral interviews': 'behavioral',
    'case study interviews': 'situational',
    'system design interviews': 'technical',
    'mixed interview prep': 'behavioral',
  };
  const canonicalValue = aliases[normalizedValue] || normalizedValue;

  return SUPPORTED_PROFILE_INTERVIEW_TYPES.has(canonicalValue) ? canonicalValue : 'behavioral';
}

function normalizeAvailabilityValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    return normalizedValue ? { label: normalizedValue } : {};
  }

  if (typeof value === 'object') {
    return value;
  }

  return {};
}

function normalizeNotificationPreferences(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return {
      enabled: value,
      interviewReminders: value,
      productUpdates: value,
    };
  }

  if (value && typeof value === 'object') {
    return {
      enabled: value.enabled !== false,
      ...value,
    };
  }

  return {};
}

function formatInterviewTitle(interviewType, role) {
  const normalizedInterviewType = String(interviewType || 'Mock').trim();
  const normalizedRole = String(role || '').trim();
  const typeLabel = normalizedInterviewType.charAt(0).toUpperCase() + normalizedInterviewType.slice(1);

  return normalizedRole
    ? `${typeLabel} Interview - ${normalizedRole}`
    : `${typeLabel} Interview`;
}

function getFrontendOrigin() {
  return (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
}

function buildVerificationUrl(certificateCode) {
  return `${getFrontendOrigin()}/verify/${certificateCode}`;
}

function getMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getTodayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

async function ensureUser(firebaseUid, identity = {}) {
  const currentUser = await findUserById(firebaseUid);
  const userData = {
    userId: firebaseUid,
    lastLoginAt: new Date(),
  };

  if (identity.email && !currentUser?.email) {
    userData.email = identity.email;
  }

  if (identity.name && !currentUser?.name) {
    userData.name = identity.name;
  }

  if (identity.photoURL && !currentUser?.photoURL && !currentUser?.onboarded) {
    userData.photoURL = identity.photoURL;
  }

  if (identity.provider && !currentUser?.provider) {
    userData.provider = identity.provider;
  }

  await upsertUser(userData);

  return getUserRowByFirebaseUid(firebaseUid);
}

function normalizeSettingsRow(row) {
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    locale: row.locale || DEFAULT_SETTINGS.locale,
    timezone: row.timezone || DEFAULT_SETTINGS.timezone,
    marketingEmails: Boolean(row.marketing_emails),
    productUpdates: row.product_updates !== false,
    interviewReminders: row.interview_reminders !== false,
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...normalizeJsonValue(row.privacy, {}),
    },
    cookieConsent: {
      ...DEFAULT_SETTINGS.cookieConsent,
      ...normalizeJsonValue(row.cookie_consent, {}),
    },
  };
}

function normalizeProgressRow(row) {
  if (!row) {
    return {
      interviewsCompleted: 0,
      averageScore: 0,
      totalPracticeSeconds: 0,
      currentStreak: 0,
      longestStreak: 0,
      resumeAnalysesCompleted: 0,
      certificatesEarned: 0,
      achievementsUnlocked: 0,
      lastActivityAt: null,
      snapshot: {},
    };
  }

  return {
    interviewsCompleted: normalizeNumber(row.interviews_completed),
    averageScore: normalizeNumber(row.average_score),
    totalPracticeSeconds: normalizeNumber(row.total_practice_seconds),
    currentStreak: normalizeNumber(row.current_streak),
    longestStreak: normalizeNumber(row.longest_streak),
    resumeAnalysesCompleted: normalizeNumber(row.resume_analyses_completed),
    certificatesEarned: normalizeNumber(row.certificates_earned),
    achievementsUnlocked: normalizeNumber(row.achievements_unlocked),
    lastActivityAt: row.last_activity_at || null,
    snapshot: normalizeJsonValue(row.snapshot, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeResumeAnalysisRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    overallScore: normalizeNumber(row.overall_score),
    atsScore: normalizeNumber(row.ats_score),
    strengths: normalizeJsonValue(row.strengths, []),
    improvements: normalizeJsonValue(row.improvements, []),
    keywords: normalizeJsonValue(row.keywords, []),
    report: normalizeJsonValue(row.report, {}),
    analyzerVersion: row.analyzer_version || null,
    createdAt: row.created_at || null,
    fileName: row.file_name || null,
    mimeType: row.mime_type || null,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : null,
  };
}

function normalizeAchievementRow(row) {
  return {
    id: row.id || row.achievement_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    points: normalizeNumber(row.points),
    progress: normalizeNumber(row.progress),
    unlockedAt: row.unlocked_at || null,
    unlocked: Boolean(row.unlocked_at),
    criteria: normalizeJsonValue(row.criteria, {}),
    evidence: normalizeJsonValue(row.evidence, {}),
    metadata: normalizeJsonValue(row.metadata, {}),
  };
}

function normalizeCertificateRow(row) {
  if (!row) {
    return null;
  }

  const metadata = normalizeJsonValue(row.metadata, {});
  const achievements = metadata.achievements || {};

  return {
    id: row.id,
    certificateCode: row.certificate_code,
    certificateType: row.certificate_type,
    title: row.title,
    description: row.description,
    verificationUrl: row.verification_url || buildVerificationUrl(row.certificate_code),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    metadata,
    recipientName: row.display_name || row.recipient_name || row.email || 'TryInterview Member',
    recipientEmail: row.email || null,
    achievements: {
      interviewsCompleted: normalizeNumber(achievements.interviewsCompleted),
      averageScore: normalizeNumber(achievements.averageScore),
      skillsAssessed: Array.isArray(achievements.skillsAssessed) ? achievements.skillsAssessed : [],
      hoursCompleted: normalizeNumber(achievements.hoursCompleted),
    },
  };
}

function normalizeQuestionRow(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    role: row.role,
    company: row.company,
    interviewType: row.interview_type,
    difficulty: row.difficulty,
    questionText: row.question_text,
    sampleAnswer: row.sample_answer,
    tags: normalizeJsonValue(row.tags, []),
    metadata: normalizeJsonValue(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeQuestionCategoryRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    count: normalizeNumber(row.question_count),
  };
}

async function getUsageSummary(firebaseUid) {
  const monthStart = getMonthStart();
  const rows = await query(`
    SELECT
      COUNT(*)::integer AS total_interviews,
      COUNT(*) FILTER (WHERE i.created_at >= $2::timestamp)::integer AS month_interviews,
      COUNT(*) FILTER (WHERE i.status = 'completed')::integer AS completed_interviews
    FROM interviews i
    JOIN app_users u ON u.id = i.user_id
    WHERE u.firebase_uid = $1::text
  `, [firebaseUid, monthStart]);

  const resumeRows = await query(`
    SELECT
      COUNT(*)::integer AS month_resume_analyses
    FROM resume_analyses ra
    JOIN app_users u ON u.id = ra.user_id
    WHERE u.firebase_uid = $1::text
      AND ra.created_at >= $2::timestamp
  `, [firebaseUid, monthStart]);

  const interviewMetrics = rows[0] || {};
  const resumeMetrics = resumeRows[0] || {};

  return {
    totalInterviews: normalizeNumber(interviewMetrics.total_interviews),
    monthInterviews: normalizeNumber(interviewMetrics.month_interviews),
    completedInterviews: normalizeNumber(interviewMetrics.completed_interviews),
    monthResumeAnalyses: normalizeNumber(resumeMetrics.month_resume_analyses),
  };
}

async function createResumeUploadRecord(firebaseUid, payload = {}) {
  const userRow = await getUserRowByFirebaseUid(firebaseUid);

  if (!userRow || !payload.fileName) {
    return null;
  }

  const rows = await query(`
    INSERT INTO resume_uploads (
      user_id,
      file_name,
      mime_type,
      size_bytes
    )
    VALUES ($1::uuid, $2::text, $3::text, $4::bigint)
    RETURNING id
  `, [
    userRow.id,
    payload.fileName,
    payload.mimeType || null,
    payload.sizeBytes || null,
  ]);

  return rows[0]?.id || null;
}

function calculateStreaks(dateValues) {
  const uniqueDays = Array.from(new Set(
    dateValues
      .filter(Boolean)
      .map((value) => new Date(value).toISOString().slice(0, 10))
  )).sort();

  if (!uniqueDays.length) {
    return {
      currentStreak: 0,
      longestStreak: 0,
    };
  }

  let longestStreak = 1;
  let runningStreak = 1;

  for (let index = 1; index < uniqueDays.length; index += 1) {
    const previousDate = new Date(`${uniqueDays[index - 1]}T00:00:00.000Z`);
    const currentDate = new Date(`${uniqueDays[index]}T00:00:00.000Z`);
    const differenceInDays = Math.round((currentDate - previousDate) / 86400000);

    if (differenceInDays === 1) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 1;
    }
  }

  const today = getTodayStart();
  const yesterday = new Date(today.getTime() - 86400000);
  const latestDate = new Date(`${uniqueDays[uniqueDays.length - 1]}T00:00:00.000Z`);

  let currentStreak = 0;
  const latestDifference = Math.round((today - latestDate) / 86400000);

  if (latestDifference === 0 || latestDifference === 1) {
    currentStreak = 1;

    for (let index = uniqueDays.length - 1; index > 0; index -= 1) {
      const currentDate = new Date(`${uniqueDays[index]}T00:00:00.000Z`);
      const previousDate = new Date(`${uniqueDays[index - 1]}T00:00:00.000Z`);
      const differenceInDays = Math.round((currentDate - previousDate) / 86400000);

      if (differenceInDays === 1) {
        currentStreak += 1;
        continue;
      }

      break;
    }
  }

  if (latestDate.getTime() < yesterday.getTime()) {
    currentStreak = 0;
  }

  return {
    currentStreak,
    longestStreak,
  };
}

async function refreshProgressState(firebaseUid) {
  ensurePostgresEnabled();
  const baseProgressRow = await refreshUserProgress(firebaseUid);
  const userRow = await getUserRowByFirebaseUid(firebaseUid);

  if (!userRow) {
    return normalizeProgressRow(baseProgressRow);
  }

  const completedInterviewRows = await query(`
    SELECT COALESCE(completed_at, updated_at, created_at) AS activity_at
    FROM interviews
    WHERE user_id = $1
      AND status = 'completed'
    ORDER BY activity_at DESC
  `, [userRow.id]);

  const streaks = calculateStreaks(completedInterviewRows.map((row) => row.activity_at));

  const updatedRows = await query(`
    UPDATE user_progress
    SET
      current_streak = $2::integer,
      longest_streak = $3::integer,
      snapshot = snapshot || jsonb_build_object(
        'currentStreak', $2::integer,
        'longestStreak', $3::integer
      ),
      updated_at = NOW()
    WHERE user_id = $1::uuid
    RETURNING *
  `, [userRow.id, streaks.currentStreak, streaks.longestStreak]);

  return normalizeProgressRow(updatedRows[0] || baseProgressRow);
}

async function getUserSettings(firebaseUid) {
  ensurePostgresEnabled();
  const userRow = await getUserRowByFirebaseUid(firebaseUid);

  if (!userRow) {
    return { ...DEFAULT_SETTINGS };
  }

  const rows = await query(`
    SELECT *
    FROM user_settings
    WHERE user_id = $1
    LIMIT 1
  `, [userRow.id]);

  return normalizeSettingsRow(rows[0] || null);
}

async function getUserProfileSnapshot(firebaseUid, identity = {}) {
  ensurePostgresEnabled();
  await ensureUser(firebaseUid, identity);

  const [profile, settings, subscription, progress] = await Promise.all([
    findUserById(firebaseUid),
    getUserSettings(firebaseUid),
    findActiveSubscription(firebaseUid),
    refreshProgressState(firebaseUid),
  ]);

  return {
    exists: Boolean(profile),
    user: profile,
    settings,
    progress,
    subscription: subscription ? {
      hasSubscription: true,
      ...subscription,
    } : {
      hasSubscription: false,
      status: 'free',
      planName: 'Free',
    },
  };
}

async function saveUserProfile(firebaseUid, payload = {}, identity = {}) {
  ensurePostgresEnabled();
  const currentUser = await findUserById(firebaseUid);
  const now = new Date();
  const profileSource = hasOwn(payload, 'onboarded') && payload.onboarded ? 'onboarding' : 'profile';
  const userData = {
    userId: firebaseUid,
    lastLoginAt: now,
    metadata: {
      profile: {
        lastUpdatedAt: now.toISOString(),
        source: profileSource,
      },
    },
  };

  if (hasOwn(payload, 'email')) {
    userData.email = normalizeOptionalText(payload.email, { maxLength: 240 });
  } else if (identity.email && !currentUser?.email) {
    userData.email = identity.email;
  }

  if (hasOwn(payload, 'name')) {
    userData.name = normalizeOptionalText(payload.name);
  } else if (identity.name && !currentUser?.name) {
    userData.name = identity.name;
  }

  if (hasOwn(payload, 'photoURL')) {
    userData.photoURL = normalizeOptionalText(payload.photoURL, { maxLength: 600000 });
  } else if (identity.photoURL && !currentUser?.photoURL && !currentUser?.onboarded) {
    userData.photoURL = identity.photoURL;
  }

  if (hasOwn(payload, 'provider')) {
    userData.provider = normalizeOptionalText(payload.provider, { maxLength: 80 });
  } else if (identity.provider && !currentUser?.provider) {
    userData.provider = identity.provider;
  }

  if (hasOwn(payload, 'emailVerified')) {
    userData.emailVerified = Boolean(payload.emailVerified);
  }

  if (hasOwn(payload, 'onboarded')) {
    userData.onboarded = Boolean(payload.onboarded);
    userData.onboardingCompletedAt = payload.onboarded
      ? (currentUser?.onboardingCompletedAt || now)
      : null;
  }

  if (hasOwn(payload, 'jobTitle')) {
    userData.jobTitle = normalizeOptionalText(payload.jobTitle);
  }

  if (hasOwn(payload, 'targetRole')) {
    userData.targetRole = normalizeOptionalText(payload.targetRole);
  }

  if (hasOwn(payload, 'experience')) {
    userData.experience = normalizeOptionalText(payload.experience, { maxLength: 80 });
  }

  if (hasOwn(payload, 'country')) {
    userData.country = normalizeOptionalText(payload.country, { maxLength: 120 });
  }

  if (hasOwn(payload, 'preferredLanguage')) {
    userData.preferredLanguage = normalizeOptionalText(payload.preferredLanguage, { maxLength: 80 });
  }

  if (hasOwn(payload, 'gender')) {
    userData.gender = normalizeOptionalText(payload.gender, { maxLength: 40 });
  }

  if (hasOwn(payload, 'phoneNumber')) {
    userData.phoneNumber = normalizeOptionalText(payload.phoneNumber, { maxLength: 30 });
  }

  if (hasOwn(payload, 'skills')) {
    userData.skills = normalizeStringArray(payload.skills, {
      maxItems: 20,
      maxItemLength: 64,
    });
  }

  if (hasOwn(payload, 'goals')) {
    userData.goals = normalizeOptionalText(payload.goals, { maxLength: 1000 });
  }

  if (hasOwn(payload, 'interviewType')) {
    userData.interviewType = normalizeProfileInterviewType(payload.interviewType);
  }

  if (hasOwn(payload, 'availability')) {
    userData.availability = normalizeAvailabilityValue(payload.availability);
  }

  if (hasOwn(payload, 'notifications')) {
    userData.notifications = normalizeNotificationPreferences(payload.notifications);
  }

  if (
    hasOwn(payload, 'country') ||
    hasOwn(payload, 'preferredLanguage') ||
    hasOwn(payload, 'targetRole') ||
    hasOwn(payload, 'availability') ||
    hasOwn(payload, 'profileImageName')
  ) {
    userData.metadata = {
      ...userData.metadata,
      onboarding: {
        country: userData.country ?? currentUser?.country ?? null,
        preferredLanguage: userData.preferredLanguage ?? currentUser?.preferredLanguage ?? null,
        targetRole: userData.targetRole ?? currentUser?.targetRole ?? null,
        availability: userData.availability ?? currentUser?.availability ?? {},
        profileImageName: normalizeOptionalText(payload.profileImageName, { maxLength: 180 }),
        completedAt: userData.onboardingCompletedAt
          ? new Date(userData.onboardingCompletedAt).toISOString()
          : (currentUser?.onboardingCompletedAt ? new Date(currentUser.onboardingCompletedAt).toISOString() : null),
      },
    };
  }

  const savedUser = await upsertUser(userData);

  if (hasOwn(payload, 'notifications')) {
    const notificationPreferences = normalizeNotificationPreferences(payload.notifications);
    await updateUserSettings(firebaseUid, {
      productUpdates: Boolean(notificationPreferences?.productUpdates ?? notificationPreferences?.enabled),
      interviewReminders: Boolean(notificationPreferences?.interviewReminders ?? notificationPreferences?.enabled),
    });
  }

  const [settings, subscription, progress] = await Promise.all([
    getUserSettings(firebaseUid),
    findActiveSubscription(firebaseUid),
    refreshProgressState(firebaseUid),
  ]);
  const snapshot = {
    profile: savedUser,
    settings,
    subscription: subscription ? {
      hasSubscription: true,
      ...subscription,
    } : {
      hasSubscription: false,
      status: 'free',
      planName: 'Free',
    },
    progress,
  };
  const onboardingCompleted = Boolean(savedUser?.onboarded && !currentUser?.onboarded);

  await recordUserActivity(firebaseUid, {
    eventType: onboardingCompleted ? 'profile.onboarding_completed' : 'profile.updated',
    eventSource: 'api:user-profile',
    entityType: 'user_profile',
    entityId: firebaseUid,
    payload: {
      onboarded: Boolean(savedUser?.onboarded),
      jobTitle: savedUser?.jobTitle || null,
      targetRole: savedUser?.targetRole || null,
      country: savedUser?.country || null,
      preferredLanguage: savedUser?.preferredLanguage || null,
      interviewType: savedUser?.interviewType || null,
      skillsCount: Array.isArray(savedUser?.skills) ? savedUser.skills.length : 0,
    },
  }, {
    snapshot,
  });

  return snapshot;
}

async function saveUserSettings(firebaseUid, settings) {
  ensurePostgresEnabled();
  await updateUserSettings(firebaseUid, settings);
  const savedSettings = await getUserSettings(firebaseUid);
  const [profile, subscription, progress] = await Promise.all([
    findUserById(firebaseUid),
    findActiveSubscription(firebaseUid),
    refreshProgressState(firebaseUid),
  ]);
  const snapshot = {
    profile,
    settings: savedSettings,
    subscription: subscription ? {
      hasSubscription: true,
      ...subscription,
    } : {
      hasSubscription: false,
      status: 'free',
      planName: 'Free',
    },
    progress,
  };

  await recordUserActivity(firebaseUid, {
    eventType: 'settings.updated',
    eventSource: 'api:settings',
    entityType: 'user_settings',
    entityId: firebaseUid,
    payload: {
      locale: savedSettings.locale,
      timezone: savedSettings.timezone,
      marketingEmails: savedSettings.marketingEmails,
      productUpdates: savedSettings.productUpdates,
      interviewReminders: savedSettings.interviewReminders,
      shareCertificates: savedSettings.privacy?.shareCertificates !== false,
      analyticsCookies: Boolean(savedSettings.cookieConsent?.analytics),
    },
  }, {
    snapshot,
  });

  return savedSettings;
}

async function ensureQuestionBankSeedData() {
  ensurePostgresEnabled();
  const categoryCountRows = await query('SELECT COUNT(*)::integer AS count FROM question_bank_categories');
  const itemCountRows = await query('SELECT COUNT(*)::integer AS count FROM question_bank_items');

  if (normalizeNumber(categoryCountRows[0]?.count) > 0 && normalizeNumber(itemCountRows[0]?.count) > 0) {
    return;
  }

  for (const category of QUESTION_BANK_SEED) {
    await query(`
      INSERT INTO question_bank_categories (slug, name, description)
      VALUES ($1::text, $2::text, $3::text)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description
    `, [category.slug, category.name, category.description]);
  }

  const categoryRows = await query(`
    SELECT id, slug
    FROM question_bank_categories
    WHERE slug = ANY($1::text[])
  `, [QUESTION_BANK_SEED.map((category) => category.slug)]);

  const categoryIdsBySlug = categoryRows.reduce((accumulator, row) => ({
    ...accumulator,
    [row.slug]: row.id,
  }), {});

  for (const category of QUESTION_BANK_SEED) {
    const categoryId = categoryIdsBySlug[category.slug];

    for (const item of category.items) {
      const existingRows = await query(`
        SELECT id
        FROM question_bank_items
        WHERE category_id = $1::integer
          AND question_text = $2::text
      `, [categoryId, item.questionText]);

      if (existingRows.length) {
        continue;
      }

      await query(`
        INSERT INTO question_bank_items (
          category_id,
          role,
          company,
          interview_type,
          difficulty,
          question_text,
          sample_answer,
          tags,
          metadata
        )
        VALUES (
          $1::integer,
          $2::text,
          $3::text,
          $4::text,
          COALESCE($5::text, 'general'),
          $6::text,
          COALESCE($7::jsonb, '[]'::jsonb),
          COALESCE($8::jsonb, '{}'::jsonb)
        )
      `, [
        categoryId,
        item.role,
        item.company,
        item.interviewType,
        item.difficulty,
        item.questionText,
        item.sampleAnswer,
        toJsonb(item.tags, null),
        toJsonb({ seeded: true }, null),
      ]);
    }
  }
}

async function listQuestionBankCategories() {
  await ensureQuestionBankSeedData();

  const rows = await query(`
    SELECT
      c.id,
      c.slug,
      c.name,
      c.description,
      COUNT(i.id)::integer AS question_count
    FROM question_bank_categories c
    LEFT JOIN question_bank_items i
      ON i.category_id = c.id
      AND i.is_active = TRUE
    GROUP BY c.id, c.slug, c.name, c.description
    ORDER BY c.name ASC
  `);

  return rows.map(normalizeQuestionCategoryRow);
}

async function listQuestionBankItems(filters = {}) {
  await ensureQuestionBankSeedData();

  const search = filters.search ? String(filters.search).trim() : null;
  const category = filters.category ? String(filters.category).trim() : null;
  const difficulty = filters.difficulty ? String(filters.difficulty).trim() : null;
  const interviewType = filters.interviewType ? String(filters.interviewType).trim() : null;
  const limit = Math.min(Math.max(Number(filters.limit) || 12, 1), 100);

  const rows = await query(`
    SELECT
      i.*,
      c.slug AS category_slug,
      c.name AS category_name
    FROM question_bank_items i
    LEFT JOIN question_bank_categories c ON c.id = i.category_id
    WHERE i.is_active = TRUE
      AND ($1::text IS NULL OR c.slug = $1)
      AND ($2::text IS NULL OR i.difficulty = $2)
      AND ($3::text IS NULL OR i.interview_type = $3)
      AND (
        $4::text IS NULL
        OR i.question_text ILIKE '%' || $4 || '%'
        OR COALESCE(i.role, '') ILIKE '%' || $4 || '%'
        OR COALESCE(i.company, '') ILIKE '%' || $4 || '%'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(i.tags) AS tag
          WHERE tag ILIKE '%' || $4 || '%'
        )
      )
    ORDER BY c.name ASC, i.created_at DESC
    LIMIT $5::integer
  `, [category, difficulty, interviewType, search, limit]);

  return rows.map(normalizeQuestionRow);
}

async function listResumeAnalysisHistory(firebaseUid, limit = 10) {
  ensurePostgresEnabled();
  const rows = await query(`
    SELECT
      ra.*,
      ru.file_name,
      ru.mime_type,
      ru.size_bytes
    FROM resume_analyses ra
    JOIN app_users u ON u.id = ra.user_id
    LEFT JOIN resume_uploads ru ON ru.id = ra.resume_upload_id
    WHERE u.firebase_uid = $1
    ORDER BY ra.created_at DESC
    LIMIT $2::integer
  `, [firebaseUid, limit]);

  return rows.map(normalizeResumeAnalysisRow);
}

async function listUserAchievements(firebaseUid) {
  ensurePostgresEnabled();
  const userRow = await getUserRowByFirebaseUid(firebaseUid);

  if (!userRow) {
    return [];
  }

  const rows = await query(`
    SELECT
      ad.id AS achievement_id,
      ad.slug,
      ad.name,
      ad.description,
      ad.category,
      ad.criteria,
      ad.points,
      ad.metadata,
      ua.id,
      ua.progress,
      ua.unlocked_at,
      ua.evidence
    FROM achievement_definitions ad
    LEFT JOIN user_achievements ua
      ON ua.achievement_id = ad.id
      AND ua.user_id = $1
    ORDER BY COALESCE(ua.unlocked_at, ua.updated_at, ua.created_at) DESC NULLS LAST, ad.points DESC, ad.name ASC
  `, [userRow.id]);

  return rows.map(normalizeAchievementRow);
}

async function listUserCertificates(firebaseUid) {
  ensurePostgresEnabled();
  const rows = await query(`
    SELECT
      c.*,
      u.display_name,
      u.email
    FROM certificates c
    JOIN app_users u ON u.id = c.user_id
    WHERE u.firebase_uid = $1
      AND c.revoked_at IS NULL
    ORDER BY c.issued_at DESC
  `, [firebaseUid]);

  return rows.map(normalizeCertificateRow);
}

async function findCertificateByCode(certificateCode) {
  ensurePostgresEnabled();
  const rows = await query(`
    SELECT
      c.*,
      u.display_name,
      u.email
    FROM certificates c
    JOIN app_users u ON u.id = c.user_id
    WHERE c.certificate_code = $1
    LIMIT 1
  `, [certificateCode]);

  return normalizeCertificateRow(rows[0] || null);
}

async function getQuestionBankSummary(limit = 6) {
  const [categories, questions] = await Promise.all([
    listQuestionBankCategories(),
    listQuestionBankItems({ limit }),
  ]);

  return {
    categories,
    totalQuestions: categories.reduce((sum, category) => sum + category.count, 0),
    preview: questions,
  };
}

async function getDashboardSnapshot(firebaseUid, identity = {}) {
  ensurePostgresEnabled();
  await ensureUser(firebaseUid, identity);

  const [profile, settings, subscription, progress, interviews, achievements, certificates, resumeAnalyses, questionBank, usage] = await Promise.all([
    findUserById(firebaseUid),
    getUserSettings(firebaseUid),
    findActiveSubscription(firebaseUid),
    refreshProgressState(firebaseUid),
    listInterviewHistory(firebaseUid, 8),
    listUserAchievements(firebaseUid),
    listUserCertificates(firebaseUid),
    listResumeAnalysisHistory(firebaseUid, 5),
    getQuestionBankSummary(6),
    getUsageSummary(firebaseUid),
  ]);

  const dashboardSnapshot = {
    profile,
    settings,
    subscription: subscription ? {
      hasSubscription: true,
      ...subscription,
    } : {
      hasSubscription: false,
      status: 'free',
      planName: 'Free',
      trialMockInterviews: 1,
    },
    entitlements: buildEntitlements(subscription, usage),
    progress,
    interviews: {
      recent: interviews,
      total: usage.totalInterviews,
      completed: usage.completedInterviews,
    },
    achievements,
    certificates,
    resumeAnalyses,
    questionBank,
  };

  await syncUserMirror(firebaseUid, dashboardSnapshot);
  return dashboardSnapshot;
}

function buildInterviewScoreSeed(firebaseUid, interviewType, role, difficulty) {
  return crypto
    .createHash('sha256')
    .update([firebaseUid, interviewType, role, difficulty, Date.now()].join(':'))
    .digest('hex');
}

function createGeneratedInterviewFeedback({ interviewType, role, company, difficulty, score }) {
  const normalizedType = String(interviewType || 'mock').toLowerCase();
  const normalizedRole = role || 'your target role';
  const normalizedCompany = company || 'a growth-focused team';
  const normalizedDifficulty = difficulty || 'medium';

  const strengths = [
    `You communicated clearly while staying aligned to the expectations for a ${normalizedRole} interview.`,
    `Your answers showed structured thinking and a confident pace for a ${normalizedType} scenario.`,
    `You connected your examples back to impact, which is important for hiring teams at ${normalizedCompany}.`,
  ];

  const improvements = [
    `Tighten a few answers so your strongest examples land faster in ${normalizedDifficulty} questions.`,
    `Add one more quantified outcome when describing wins to strengthen credibility.`,
    `Finish answers with a sharper takeaway so the interviewer hears the headline immediately.`,
  ];

  const actionItems = [
    'Practice two STAR stories with measurable outcomes.',
    `Rehearse a 60-second opening tailored to ${normalizedRole}.`,
    `Review 5 ${normalizedType} questions and answer them out loud before your next session.`,
  ];

  const summary = `Strong ${normalizedType} mock interview for ${normalizedRole}. Your delivery was confident, structured, and close to real interview standards, with the biggest gains available in tighter storytelling and stronger quantified outcomes.`;

  return {
    overallScore: score,
    communicationScore: Math.max(score - 3, 65),
    technicalScore: normalizedType === 'technical' ? score : Math.max(score - 6, 60),
    confidenceScore: Math.max(score - 2, 68),
    structureScore: Math.max(score - 4, 64),
    strengths,
    improvements,
    actionItems,
    summary,
    detailedFeedback: {
      interviewType: normalizedType,
      role: normalizedRole,
      company: normalizedCompany,
      difficulty: normalizedDifficulty,
    },
  };
}

async function ensureFoundationCertificate(firebaseUid, profile, progress) {
  const existingCertificates = await listUserCertificates(firebaseUid);
  const existingFoundationCertificate = existingCertificates.find((certificate) => (
    certificate.certificateType === 'foundations'
  ));

  if (existingFoundationCertificate || progress.interviewsCompleted < 1) {
    return existingFoundationCertificate || null;
  }

  const certificateCode = `TIA-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const certificate = await issueCertificate(firebaseUid, {
    certificateCode,
    certificateType: 'foundations',
    title: 'AI Interview Foundations',
    description: 'Issued for successfully completing your first TryInterview mock interview milestone.',
    verificationUrl: buildVerificationUrl(certificateCode),
    metadata: {
      achievements: {
        interviewsCompleted: progress.interviewsCompleted,
        averageScore: progress.averageScore,
        skillsAssessed: ['Communication', 'Problem Solving', 'Structured Thinking', 'Interview Readiness'],
        hoursCompleted: Number((progress.totalPracticeSeconds / 3600).toFixed(1)),
      },
    },
  });

  await recordUserActivity(firebaseUid, {
    eventType: 'certificate.issued',
    eventSource: 'platform:milestones',
    entityType: 'certificate',
    entityId: certificate.id,
    payload: {
      certificateCode,
      certificateType: 'foundations',
      title: 'AI Interview Foundations',
    },
  });

  return normalizeCertificateRow({
    ...certificate,
    display_name: profile?.name,
    email: profile?.email,
  });
}

async function applyInterviewMilestones(firebaseUid, interviewId = null) {
  const progress = await refreshProgressState(firebaseUid);
  const scoreAchievementProgress = Math.min(Math.round((progress.averageScore / 90) * 100), 100);
  await grantAchievement(firebaseUid, 'score-ninety', scoreAchievementProgress, {
    latestInterviewId: interviewId,
    averageScore: progress.averageScore,
  });
  const streakAchievementProgress = Math.min(Math.round((progress.currentStreak / 7) * 100), 100);
  await grantAchievement(firebaseUid, 'streak-seven', streakAchievementProgress, {
    currentStreak: progress.currentStreak,
    latestInterviewId: interviewId,
  });
  const profile = await findUserById(firebaseUid);
  const foundationCertificate = await ensureFoundationCertificate(firebaseUid, profile, progress);
  const updatedProgress = await refreshProgressState(firebaseUid);

  return {
    progress: updatedProgress,
    certificate: foundationCertificate,
  };
}

async function createMockInterviewSession(firebaseUid, payload = {}, identity = {}) {
  ensurePostgresEnabled();
  const subscription = await findActiveSubscription(firebaseUid);
  const usage = await getUsageSummary(firebaseUid);
  const entitlements = buildEntitlements(subscription, usage);

  if (entitlements.interviewsRemaining !== null && entitlements.interviewsRemaining <= 0) {
    const error = new Error('You have reached the mock interview limit for your current plan.');
    error.code = 'INTERVIEW_LIMIT_REACHED';
    error.statusCode = 403;
    throw error;
  }

  const interviewType = String(payload.interviewType || 'behavioral').trim().toLowerCase();
  const role = String(payload.role || 'Interview Candidate').trim();
  const company = String(payload.company || 'TryInterview').trim();
  const difficulty = String(payload.difficulty || 'medium').trim();
  const scoreSeed = buildInterviewScoreSeed(firebaseUid, interviewType, role, difficulty);
  const hashValue = parseInt(scoreSeed.slice(0, 4), 16);
  const baseScore = interviewType === 'technical' ? 82 : interviewType === 'leadership' ? 80 : 84;
  const difficultyAdjustment = difficulty.toLowerCase() === 'hard' ? -3 : difficulty.toLowerCase() === 'easy' ? 3 : 0;
  const score = Math.max(70, Math.min(97, baseScore + (hashValue % 11) + difficultyAdjustment));
  const durationSeconds = 900 + (hashValue % 1200);
  const completedAt = new Date();
  const startedAt = new Date(completedAt.getTime() - durationSeconds * 1000);
  const summary = `Completed a ${difficulty} ${interviewType} mock interview for ${role} with a ${score}/100 performance score.`;
  const feedback = createGeneratedInterviewFeedback({
    interviewType,
    role,
    company,
    difficulty,
    score,
  });

  await ensureUser(firebaseUid, identity);

  const interview = await createInterview({
    userId: firebaseUid,
    title: formatInterviewTitle(interviewType, role),
    role,
    company,
    interviewType,
    difficulty,
    status: 'completed',
    startedAt,
    completedAt,
    durationSeconds,
    overallScore: score,
    summary,
    transcript: [
      {
        speaker: 'assistant',
        message: `Welcome to your ${interviewType} mock interview for ${role}.`,
      },
      {
        speaker: 'assistant',
        message: 'The session has been scored and saved so you can review progress in your dashboard.',
      },
    ],
    metadata: {
      source: 'dashboard',
      generated: true,
      planKey: entitlements.planKey,
    },
  });

  await saveInterviewFeedback(interview.id, feedback);
  await grantAchievement(firebaseUid, 'first-interview', 100, {
    interviewId: interview.id,
  });
  const milestoneResult = await applyInterviewMilestones(firebaseUid, interview.id);
  const dashboardSnapshot = await getDashboardSnapshot(firebaseUid, identity);

  await recordUserActivity(firebaseUid, {
    eventType: 'interview.mock_completed',
    eventSource: 'api:interviews',
    entityType: 'interview',
    entityId: interview.id,
    payload: {
      overallScore: score,
      durationSeconds,
      interviewType,
      difficulty,
      role,
      company,
      certificateCode: milestoneResult.certificate?.certificateCode || null,
    },
  }, {
    snapshot: dashboardSnapshot,
  });

  return {
    interview: {
      ...interview,
      overallScore: score,
      feedback,
    },
    entitlements: buildEntitlements(subscription, {
      ...usage,
      totalInterviews: usage.totalInterviews + 1,
      monthInterviews: usage.monthInterviews + 1,
      completedInterviews: usage.completedInterviews + 1,
    }),
    progress: milestoneResult.progress,
    certificate: milestoneResult.certificate,
  };
}

function detectKeywords(resumeText) {
  const normalizedText = String(resumeText || '').toLowerCase();
  const keywordPool = [
    'react',
    'javascript',
    'typescript',
    'node',
    'python',
    'sql',
    'leadership',
    'communication',
    'product',
    'analytics',
    'aws',
    'docker',
    'agile',
    'system design',
    'customer success',
  ];

  return keywordPool.filter((keyword) => normalizedText.includes(keyword)).slice(0, 10);
}

function buildResumeAnalysis(payload = {}) {
  const resumeText = String(payload.resumeText || '').trim();
  const normalizedText = resumeText.toLowerCase();
  const sections = [
    { key: 'summary', label: 'professional summary', aliases: ['summary', 'profile'] },
    { key: 'experience', label: 'experience section', aliases: ['experience', 'work history'] },
    { key: 'skills', label: 'skills section', aliases: ['skills', 'core competencies'] },
    { key: 'education', label: 'education section', aliases: ['education'] },
  ];

  const detectedSections = sections.filter((section) => (
    section.aliases.some((alias) => normalizedText.includes(alias))
  ));
  const detectedKeywords = detectKeywords(resumeText);
  const quantifiedMatches = resumeText.match(/\b\d+(%|\+|x|k|m)?\b/gi) || [];
  const actionVerbMatches = resumeText.match(/\b(built|led|improved|launched|scaled|designed|increased|reduced|optimized|owned)\b/gi) || [];

  let overallScore = 52;
  let atsScore = 56;

  overallScore += detectedSections.length * 6;
  atsScore += detectedSections.length * 5;
  overallScore += Math.min(detectedKeywords.length * 3, 18);
  atsScore += Math.min(detectedKeywords.length * 4, 20);
  overallScore += Math.min(quantifiedMatches.length * 2, 10);
  overallScore += Math.min(actionVerbMatches.length, 8);

  if (resumeText.length > 1200) {
    overallScore += 5;
    atsScore += 4;
  } else if (resumeText.length < 300) {
    overallScore -= 6;
    atsScore -= 4;
  }

  overallScore = Math.max(48, Math.min(96, overallScore));
  atsScore = Math.max(50, Math.min(98, atsScore));

  const strengths = [];
  const improvements = [];

  if (detectedSections.length >= 3) {
    strengths.push('Your resume includes the core sections recruiters expect to see quickly.');
  } else {
    improvements.push('Add clearer core sections so recruiters and ATS tools can scan your background faster.');
  }

  if (quantifiedMatches.length >= 3) {
    strengths.push('You use quantified results, which makes your impact easier to trust and remember.');
  } else {
    improvements.push('Add more measurable results like percentages, revenue, users, or delivery time saved.');
  }

  if (actionVerbMatches.length >= 4) {
    strengths.push('Your bullet points use strong action language that improves clarity and energy.');
  } else {
    improvements.push('Start more bullet points with direct action verbs to sharpen your accomplishments.');
  }

  if (detectedKeywords.length >= 4) {
    strengths.push('Relevant role keywords are already present, which helps with ATS matching.');
  } else {
    improvements.push('Incorporate more role-specific keywords from the job description to improve ATS match quality.');
  }

  if (!strengths.length) {
    strengths.push('The resume has a workable foundation and can improve quickly with targeted edits.');
  }

  if (!improvements.length) {
    improvements.push('Tighten a few bullets and tailor the summary section to each target role.');
  }

  const report = {
    textLength: resumeText.length,
    detectedSections: detectedSections.map((section) => section.label),
    quantifiedResults: quantifiedMatches.length,
    actionVerbs: actionVerbMatches.length,
    detectedKeywords,
    fileName: payload.fileName || null,
    mimeType: payload.mimeType || null,
    fallbackAnalysis: resumeText.length < 80,
  };

  return {
    overallScore,
    atsScore,
    strengths,
    improvements,
    keywords: detectedKeywords,
    report,
    analyzerVersion: 'baseline-v1',
  };
}

async function analyzeResumeSubmission(firebaseUid, payload = {}, identity = {}) {
  ensurePostgresEnabled();
  await ensureUser(firebaseUid, identity);

  const analysis = buildResumeAnalysis(payload);
  const resumeUploadId = await createResumeUploadRecord(firebaseUid, payload);
  const savedAnalysis = await saveResumeAnalysis(firebaseUid, {
    ...analysis,
    resumeUploadId,
  });
  const history = await listResumeAnalysisHistory(firebaseUid, 6);
  const [profile, settings, subscription, progress] = await Promise.all([
    findUserById(firebaseUid),
    getUserSettings(firebaseUid),
    findActiveSubscription(firebaseUid),
    refreshProgressState(firebaseUid),
  ]);
  const snapshot = {
    profile,
    settings,
    subscription: subscription ? {
      hasSubscription: true,
      ...subscription,
    } : {
      hasSubscription: false,
      status: 'free',
      planName: 'Free',
    },
    progress,
    resumeAnalyses: history,
  };

  await recordUserActivity(firebaseUid, {
    eventType: 'resume.analysis_created',
    eventSource: 'api:resume-analyses',
    entityType: 'resume_analysis',
    entityId: savedAnalysis?.id || null,
    payload: {
      overallScore: normalizeNumber(savedAnalysis?.overall_score),
      atsScore: normalizeNumber(savedAnalysis?.ats_score),
      fileName: payload.fileName || null,
      detectedKeywords: Array.isArray(analysis.keywords) ? analysis.keywords.length : 0,
    },
  }, {
    snapshot,
  });

  return {
    analysis: normalizeResumeAnalysisRow(savedAnalysis),
    history,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  analyzeResumeSubmission,
  createMockInterviewSession,
  findCertificateByCode,
  getDashboardSnapshot,
  getUserProfileSnapshot,
  getUsageSummary,
  saveUserProfile,
  getUserSettings,
  listQuestionBankCategories,
  listQuestionBankItems,
  listResumeAnalysisHistory,
  listUserAchievements,
  listUserCertificates,
  applyInterviewMilestones,
  refreshProgressState,
  saveUserSettings,
};
