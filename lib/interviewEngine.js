const { query } = require('./db/client');
const { buildEntitlements } = require('./planConfig');
const { createStructuredResponse } = require('./openaiClient');
const { hashToken } = require('./sessionSecurity');
const {
  applyInterviewMilestones,
  getDashboardSnapshot,
  getUsageSummary,
} = require('./platformStore');
const {
  createInterview,
  findActiveSubscription,
  grantAchievement,
  saveInterviewFeedback,
  upsertUser,
} = require('./postgresStore');
const {
  recordUserActivity,
} = require('./userActivityService');

const ENGINE_VERSION = 'interview-engine-v1';
const QUESTION_COUNT = Math.max(3, Math.min(8, Number(process.env.INTERVIEW_ENGINE_QUESTION_COUNT || 5)));
const GENERATION_MODEL = process.env.OPENAI_INTERVIEW_GENERATION_MODEL || 'gpt-5-mini';
const GENERATION_FALLBACK_MODEL = process.env.OPENAI_INTERVIEW_GENERATION_FALLBACK_MODEL || null;
const EVALUATION_MODEL = process.env.OPENAI_INTERVIEW_EVALUATION_MODEL || GENERATION_MODEL;
const EVALUATION_FALLBACK_MODEL = process.env.OPENAI_INTERVIEW_EVALUATION_FALLBACK_MODEL || null;
const REASONING_EFFORT = process.env.OPENAI_INTERVIEW_REASONING_EFFORT || 'low';
const SCORE_DIMENSIONS = ['relevance', 'clarity', 'structure', 'depth', 'confidence'];
const ALLOWED_INTERVIEW_TYPES = new Set(['behavioral', 'technical', 'leadership', 'situational']);
const MAX_ROLE_LENGTH = 80;
const MAX_COMPANY_LENGTH = 80;
const MAX_STAGE_LENGTH = 60;
const MAX_EXPERIENCE_LENGTH = 80;
const MAX_ANSWER_STYLE_LENGTH = 80;
const MAX_JOB_DESCRIPTION_LENGTH = 1200;
const MAX_COMPANY_CONTEXT_LENGTH = 700;
const MAX_INTERVIEW_GOALS_LENGTH = 600;
const MAX_RESUME_HIGHLIGHTS_LENGTH = 700;
const MAX_RECENT_PROJECTS_LENGTH = 700;
const MAX_FOCUS_AREAS = 6;
const MAX_MUST_COVER_TOPICS = 8;
const MAX_ANSWER_LENGTH = 5000;

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

function toJsonb(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.stringify(value);
}

function normalizeDifficulty(value) {
  const normalizedValue = String(value || 'Medium').trim().toLowerCase();

  if (normalizedValue === 'easy') {
    return 'Easy';
  }

  if (normalizedValue === 'hard') {
    return 'Hard';
  }

  return 'Medium';
}

function normalizeInterviewType(value) {
  const normalizedValue = String(value || 'behavioral').trim().toLowerCase();

  if (ALLOWED_INTERVIEW_TYPES.has(normalizedValue)) {
    return normalizedValue;
  }

  return 'behavioral';
}

function normalizeTextValue(value, { fallback = '', maxLength = 120 } = {}) {
  const normalizedValue = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalizedValue) {
    return fallback;
  }

  return normalizedValue.slice(0, maxLength);
}

function normalizeStringArray(values, { maxItems = 5, maxItemLength = 72, fallback = [] } = {}) {
  const sourceValues = Array.isArray(values)
    ? values
    : String(values || '')
      .split(',');

  const uniqueValues = [];

  for (const entry of sourceValues) {
    const normalizedEntry = normalizeTextValue(entry, {
      fallback: '',
      maxLength: maxItemLength,
    });

    if (!normalizedEntry || uniqueValues.includes(normalizedEntry)) {
      continue;
    }

    uniqueValues.push(normalizedEntry);

    if (uniqueValues.length >= maxItems) {
      break;
    }
  }

  return uniqueValues.length ? uniqueValues : fallback;
}

function buildDifficultyMix(targetDifficulty, questionCount = QUESTION_COUNT) {
  const normalizedDifficulty = normalizeDifficulty(targetDifficulty);
  const basePattern = normalizedDifficulty === 'Easy'
    ? ['Easy', 'Easy', 'Medium', 'Easy', 'Medium']
    : normalizedDifficulty === 'Hard'
      ? ['Medium', 'Hard', 'Hard', 'Medium', 'Hard']
      : ['Easy', 'Medium', 'Medium', 'Hard', 'Medium'];

  return Array.from({ length: questionCount }, (_, index) => (
    basePattern[index % basePattern.length]
  ));
}

function buildSafetyIdentifier(firebaseUid) {
  return firebaseUid ? `tryinterview_${hashToken(firebaseUid).slice(0, 32)}` : null;
}

function buildFallbackPrompt(context, index) {
  const focusArea = context.focusAreas[index % Math.max(context.focusAreas.length, 1)] || 'your approach';
  const roleLabel = context.role || 'this role';

  switch (context.interviewType) {
    case 'technical':
      return `Walk me through how you would handle ${focusArea} as a ${roleLabel}.`;
    case 'leadership':
      return `Tell me about a time you led ${focusArea} in a ${roleLabel} role.`;
    case 'situational':
      return `What would you do if ${focusArea} became the biggest blocker in your ${roleLabel} work?`;
    default:
      return `Tell me about a time your experience with ${focusArea} shaped your impact as a ${roleLabel}.`;
  }
}

function buildFallbackAnswerStrategy(interviewType) {
  switch (interviewType) {
    case 'technical':
      return 'Use a problem-solution-result structure and explain tradeoffs clearly.';
    case 'leadership':
      return 'Use STAR and emphasize alignment, ownership, and measurable outcomes.';
    case 'situational':
      return 'State your decision, the reasoning behind it, and the first concrete actions.';
    default:
      return 'Use STAR with short context, specific actions, and a measurable result.';
  }
}

function buildSessionGreeting(isFirstInterviewExperience) {
  if (isFirstInterviewExperience) {
    return [
      'Hello, I’m TryInterview.',
      'Welcome to your first mock interview session. I’ll guide you through realistic questions, evaluate your responses, and provide clear feedback to help you improve.',
      'Let’s begin. Are you ready.',
    ].join('\n\n');
  }

  return [
    'Hello, I’m TryInterview.',
    'Welcome back to your mock interview session. I’ll guide you through realistic questions, evaluate your responses, and provide clear feedback to help you improve.',
    'Let’s begin whenever you’re ready.',
  ].join('\n\n');
}

function sanitizeQuestionPlan(plan, context) {
  const questionMix = buildDifficultyMix(context.difficulty, QUESTION_COUNT);
  const rawQuestions = Array.isArray(plan?.questions) ? plan.questions : [];

  if (rawQuestions.length < QUESTION_COUNT) {
    const error = new Error('The interview engine did not generate enough questions.');
    error.statusCode = 502;
    throw error;
  }

  return {
    sessionIntro: normalizeTextValue(plan?.sessionIntro, {
      fallback: `Welcome to your ${context.interviewType} interview for ${context.role}. Let's keep this practical, focused, and conversational.`,
      maxLength: 280,
    }),
    questions: questionMix.map((difficulty, index) => {
      const question = rawQuestions[index] || {};
      const defaultFocus = context.focusAreas.length
        ? context.focusAreas.slice(0, 3)
        : ['Relevance', 'Specific examples', 'Clear communication'];

      return {
        prompt: normalizeTextValue(question.prompt, {
          fallback: buildFallbackPrompt(context, index),
          maxLength: 220,
        }),
        difficulty,
        category: normalizeTextValue(question.category, {
          fallback: capitalize(context.interviewType || 'interview'),
          maxLength: 48,
        }),
        evaluationFocus: normalizeStringArray(question.evaluationFocus, {
          maxItems: 5,
          maxItemLength: 56,
          fallback: defaultFocus,
        }),
        expectedSignals: normalizeStringArray(question.expectedSignals, {
          maxItems: 6,
          maxItemLength: 72,
          fallback: defaultFocus,
        }),
        friendlyLeadIn: normalizeTextValue(question.friendlyLeadIn, {
          fallback: 'Let’s take this one step by step.',
          maxLength: 120,
        }),
        answerStrategy: normalizeTextValue(question.answerStrategy, {
          fallback: buildFallbackAnswerStrategy(context.interviewType),
          maxLength: 140,
        }),
      };
    }),
  };
}

function capitalize(value) {
  const normalizedValue = normalizeTextValue(value, {
    fallback: 'Interview',
    maxLength: 48,
  });

  return normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1);
}

function buildQuestionGenerationSchema(questionCount) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['sessionIntro', 'questions'],
    properties: {
      sessionIntro: {
        type: 'string',
      },
      questions: {
        type: 'array',
        minItems: questionCount,
        maxItems: questionCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt', 'difficulty', 'category', 'evaluationFocus', 'expectedSignals', 'friendlyLeadIn', 'answerStrategy'],
          properties: {
            prompt: { type: 'string' },
            difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
            category: { type: 'string' },
            evaluationFocus: {
              type: 'array',
              minItems: 2,
              maxItems: 5,
              items: { type: 'string' },
            },
            expectedSignals: {
              type: 'array',
              minItems: 2,
              maxItems: 6,
              items: { type: 'string' },
            },
            friendlyLeadIn: { type: 'string' },
            answerStrategy: { type: 'string' },
          },
        },
      },
    },
  };
}

const ANSWER_EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallScore', 'summary', 'coachMessage', 'verdict', 'deliverySignal', 'nextAnswerTip', 'scoringEngine', 'feedbackEngine', 'improvementEngine'],
  properties: {
    overallScore: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
    },
    summary: { type: 'string' },
    coachMessage: { type: 'string' },
    verdict: {
      type: 'string',
      enum: ['strong', 'developing', 'weak'],
    },
    deliverySignal: {
      type: 'string',
      enum: ['sharp', 'steady', 'needs_more_presence'],
    },
    nextAnswerTip: { type: 'string' },
    scoringEngine: {
      type: 'object',
      additionalProperties: false,
      required: SCORE_DIMENSIONS,
      properties: {
        relevance: {
          type: 'object',
          additionalProperties: false,
          required: ['score', 'reason'],
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            reason: { type: 'string' },
          },
        },
        clarity: {
          type: 'object',
          additionalProperties: false,
          required: ['score', 'reason'],
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            reason: { type: 'string' },
          },
        },
        structure: {
          type: 'object',
          additionalProperties: false,
          required: ['score', 'reason'],
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            reason: { type: 'string' },
          },
        },
        depth: {
          type: 'object',
          additionalProperties: false,
          required: ['score', 'reason'],
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            reason: { type: 'string' },
          },
        },
        confidence: {
          type: 'object',
          additionalProperties: false,
          required: ['score', 'reason'],
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            reason: { type: 'string' },
          },
        },
      },
    },
    feedbackEngine: {
      type: 'object',
      additionalProperties: false,
      required: ['strengths', 'weaknesses', 'clarityIssues', 'structureIssues', 'actionableAdvice'],
      properties: {
        strengths: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' },
        },
        weaknesses: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' },
        },
        clarityIssues: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: { type: 'string' },
        },
        structureIssues: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: { type: 'string' },
        },
        actionableAdvice: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: { type: 'string' },
        },
      },
    },
    improvementEngine: {
      type: 'object',
      additionalProperties: false,
      required: ['betterStructure', 'strongerWording', 'addedDetail', 'removeWeakPhrases', 'idealAnswer', 'idealAnswerChecklist'],
      properties: {
        betterStructure: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: { type: 'string' },
        },
        strongerWording: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' },
        },
        addedDetail: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' },
        },
        removeWeakPhrases: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' },
        },
        idealAnswer: { type: 'string' },
        idealAnswerChecklist: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: { type: 'string' },
        },
      },
    },
  },
};

const FINAL_FEEDBACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'strengths', 'improvements', 'actionItems', 'recommendedDrills', 'nextMilestone', 'readinessSignal', 'hiringSignal'],
  properties: {
    summary: { type: 'string' },
    strengths: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: { type: 'string' },
    },
    improvements: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: { type: 'string' },
    },
    actionItems: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: { type: 'string' },
    },
    recommendedDrills: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string' },
    },
    nextMilestone: { type: 'string' },
    readinessSignal: {
      type: 'string',
      enum: ['ready', 'almost_ready', 'needs_more_reps'],
    },
    hiringSignal: {
      type: 'string',
      enum: ['strong_hire_signal', 'promising_but_inconsistent', 'needs_more_evidence'],
    },
  },
};

function buildInterviewPrompt(context) {
  const difficultyMix = buildDifficultyMix(context.difficulty);

  return [
    'Create a professional mock interview plan for TryInterview.',
    'You are a friendly interviewer, not a lecturer.',
    'The generated questions must satisfy these rules:',
    '1. Role relevance: every question must clearly match the candidate role.',
    '2. Difficulty mix: use the requested Easy/Medium/Hard blend exactly in order.',
    '3. Job experience fit: questions must respect the candidate experience level.',
    '4. Real-world style: sound like actual interview questions, never textbook trivia.',
    '5. Clarity: keep each question short, direct, and easy to understand.',
    '',
    `Role: ${context.role}`,
    `Interview stage: ${context.interviewStage}`,
    `Interview type: ${context.interviewType}`,
    `Experience level: ${context.experience}`,
    `Target company: ${context.company || 'General hiring team'}`,
    `Target difficulty: ${normalizeDifficulty(context.difficulty)}`,
    `Preferred answer style: ${context.answerStyle}`,
    `Difficulty blend to follow exactly: ${difficultyMix.join(', ')}`,
    `Focus areas: ${context.focusAreas.length ? context.focusAreas.join(', ') : 'General interview readiness'}`,
    `Must-cover topics: ${context.mustCoverTopics.length ? context.mustCoverTopics.join(', ') : 'None specified'}`,
    `Job description: ${context.jobDescription || 'Not provided'}`,
    `Company context: ${context.companyContext || 'Not provided'}`,
    `Resume highlights: ${context.resumeHighlights || 'Not provided'}`,
    `Recent projects: ${context.recentProjects || 'Not provided'}`,
    `Candidate goals for this session: ${context.interviewGoals || 'General interview practice and confidence building'}`,
    `Question count: ${QUESTION_COUNT}`,
    '',
    'Each prompt must be one sentence, concise, and conversational.',
    'The intro should warmly open the interview in one or two sentences.',
    'Each question must also include a short answerStrategy explaining the best response structure.',
    'When job description, resume highlights, recent projects, company context, or must-cover topics are provided, use them to make the interview more specific and realistic.',
  ].join('\n');
}

function buildEvaluationPrompt({ session, question, answer }) {
  return [
    'Evaluate this interview answer for TryInterview.',
    'Return one full answer review made of three engines.',
    '1. Scoring Engine: score relevance, clarity, structure, depth, and confidence from 0-100, and explain each score briefly.',
    '2. Feedback Engine: return strengths, weaknesses, clarity issues, structure issues, and actionable advice.',
    '3. Improvement Engine: return better structure, stronger wording, added detail, weak phrases to remove, and an ideal answer.',
    'Use these criteria only for scoring:',
    'Relevance – Did it answer the question?',
    'Clarity – Is it easy to understand?',
    'Structure – Is it well organized, including STAR or clear flow when appropriate?',
    'Depth – Does it include details, examples, or real proof?',
    'Confidence – Is the tone strong, direct, and assured?',
    '',
    `Role: ${session.role}`,
    `Interview stage: ${session.metadata.interviewStage || 'General stage'}`,
    `Interview type: ${session.interviewType}`,
    `Experience level: ${session.metadata.experience || 'Not provided'}`,
    `Preferred answer style: ${session.metadata.answerStyle || 'Clear and outcome-focused'}`,
    `Session goals: ${session.metadata.interviewGoals || 'General interview improvement'}`,
    `Question difficulty: ${question.difficulty}`,
    `Question: ${question.prompt}`,
    `Expected signals: ${question.expectedFocus.join(', ') || 'Strong relevant examples and concise reasoning'}`,
    '',
    'Candidate answer:',
    answer,
    '',
    'Return accurate but encouraging feedback.',
    'Coach message should sound like a friendly interviewer helping the candidate improve after this question.',
    'The ideal answer should sound like a polished but realistic candidate response, not robotic.',
    'nextAnswerTip should be one immediate, practical suggestion for the very next answer.',
  ].join('\n');
}

function normalizeAnswerEvaluation(evaluation) {
  const scoringEngine = normalizeJsonValue(evaluation?.scoringEngine, {});
  const feedbackEngine = normalizeJsonValue(evaluation?.feedbackEngine, {});
  const improvementEngine = normalizeJsonValue(evaluation?.improvementEngine, {});

  const dimensionScores = SCORE_DIMENSIONS.reduce((accumulator, dimension) => ({
    ...accumulator,
    [dimension]: normalizeNumber(scoringEngine?.[dimension]?.score),
  }), {});

  const dimensionFeedback = SCORE_DIMENSIONS.reduce((accumulator, dimension) => ({
    ...accumulator,
    [dimension]: String(scoringEngine?.[dimension]?.reason || '').trim(),
  }), {});

  const computedOverallScore = Math.round(
    SCORE_DIMENSIONS.reduce((total, dimension) => total + normalizeNumber(dimensionScores[dimension]), 0) /
    SCORE_DIMENSIONS.length
  );

  const ensureList = (value, fallback) => (
    Array.isArray(value) && value.filter(Boolean).length
      ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
      : fallback
  );

  return {
    ...evaluation,
    scoringEngine,
    feedbackEngine,
    improvementEngine,
    dimensionScores,
    dimensionFeedback,
    overallScore: normalizeNumber(evaluation?.overallScore, computedOverallScore),
    summary: String(evaluation?.summary || 'Your answer shows promise with clear next steps to sharpen it.').trim(),
    coachMessage: String(evaluation?.coachMessage || 'Keep your next answer tighter, more specific, and more outcome-driven.').trim(),
    nextAnswerTip: String(evaluation?.nextAnswerTip || 'Lead with your strongest example, then state the result clearly.').trim(),
    strengths: ensureList(feedbackEngine.strengths, [
      'You stayed on the topic of the question.',
      'You showed enough substance to build on.',
    ]),
    weaknesses: ensureList(feedbackEngine.weaknesses, [
      'The answer could be sharper and more specific.',
      'The impact and detail can be stronger.',
    ]),
    clarityIssues: ensureList(feedbackEngine.clarityIssues, [
      'Some parts can be stated more directly.',
    ]),
    structureIssues: ensureList(feedbackEngine.structureIssues, [
      'The answer needs a clearer beginning, middle, and outcome.',
    ]),
    actionableAdvice: ensureList(feedbackEngine.actionableAdvice, [
      'Start with the situation, explain your action, and end with the result.',
      'Add one concrete metric, example, or proof point.',
      'Replace vague language with direct action verbs.',
    ]),
    improvements: ensureList(feedbackEngine.actionableAdvice, [
      'Start with the situation, explain your action, and end with the result.',
      'Add one concrete metric, example, or proof point.',
      'Replace vague language with direct action verbs.',
    ]),
    betterStructure: ensureList(improvementEngine.betterStructure, [
      'Open with the situation in one sentence.',
      'Explain the exact action you took.',
      'Close with the measurable result or lesson.',
    ]),
    strongerWording: ensureList(improvementEngine.strongerWording, [
      'Use stronger action verbs to describe what you owned.',
      'State your contribution directly instead of sounding tentative.',
    ]),
    addedDetail: ensureList(improvementEngine.addedDetail, [
      'Add one real example or metric.',
      'Mention the scope, stakes, or outcome more clearly.',
    ]),
    removeWeakPhrases: ensureList(improvementEngine.removeWeakPhrases, [
      'Remove filler words that make the answer sound uncertain.',
      'Cut vague phrases that do not add proof or impact.',
    ]),
    idealAnswer: String(improvementEngine.idealAnswer || '').trim(),
    idealAnswerChecklist: ensureList(improvementEngine.idealAnswerChecklist, [
      'Give context quickly.',
      'Explain your action clearly.',
      'End with a strong result.',
    ]),
  };
}

function buildEvaluationResponse(question, answer, evaluation, responseDurationSeconds = null) {
  return {
    questionId: question.id,
    questionPrompt: question.prompt,
    questionCategory: question.category,
    questionDifficulty: question.difficulty,
    expectedFocus: question.expectedFocus || [],
    answerStrategy: question.answerStrategy || '',
    answerText: answer,
    answerWordCount: answer.trim().split(/\s+/).filter(Boolean).length,
    responseDurationSeconds,
    ...evaluation,
  };
}

function buildFinalSummaryPrompt({ session, questionRows, aggregate }) {
  const turns = questionRows.map((questionRow) => ({
    question: questionRow.prompt,
    difficulty: questionRow.difficulty,
    expectedFocus: questionRow.expectedFocus,
    answer: questionRow.responseText,
    evaluation: questionRow.evaluation,
  }));

  return [
    'Create the final interview summary for TryInterview.',
    'The tone should be professional, specific, motivating, and clear.',
    `Role: ${session.role}`,
    `Interview stage: ${session.metadata.interviewStage || 'General stage'}`,
    `Interview type: ${session.interviewType}`,
    `Experience: ${session.metadata.experience || 'Not provided'}`,
    `Session goals: ${session.metadata.interviewGoals || 'General interview improvement'}`,
    `Aggregate overall score: ${aggregate.overallScore}`,
    `Aggregate scores: relevance ${aggregate.dimensionScores.relevance}, clarity ${aggregate.dimensionScores.clarity}, structure ${aggregate.dimensionScores.structure}, depth ${aggregate.dimensionScores.depth}, confidence ${aggregate.dimensionScores.confidence}`,
    'Include practical drills and the next milestone the candidate should target.',
    'Interview turns JSON:',
    JSON.stringify(turns),
  ].join('\n');
}

function serializeSessionRow(row) {
  const metadata = normalizeJsonValue(row.metadata, {});

  return {
    id: row.id,
    title: row.title,
    role: row.role,
    company: row.company,
    interviewType: row.interview_type,
    difficulty: row.difficulty,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    durationSeconds: normalizeNumber(row.duration_seconds),
    overallScore: normalizeNumber(row.overall_score),
    summary: row.summary,
    metadata,
  };
}

function serializeQuestionRow(row) {
  const evaluation = normalizeJsonValue(row.evaluation, {});

  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    prompt: row.prompt,
    category: row.category,
    difficulty: normalizeDifficulty(row.difficulty),
    expectedFocus: normalizeJsonValue(row.expected_focus, []),
    responseText: row.response_text,
    responseDurationSeconds: normalizeNumber(row.response_duration_seconds),
    friendlyLeadIn: evaluation.friendlyLeadIn || '',
    answerStrategy: evaluation.answerStrategy || '',
    evaluation,
  };
}

async function ensureUser(firebaseUid, identity = {}) {
  await upsertUser({
    userId: firebaseUid,
    email: identity.email ?? null,
    name: identity.name ?? null,
    photoURL: identity.photoURL ?? null,
    provider: identity.provider ?? null,
    lastLoginAt: new Date(),
  });
}

async function findSessionById(firebaseUid, sessionId) {
  const rows = await query(`
    SELECT
      i.*
    FROM interviews i
    JOIN app_users u ON u.id = i.user_id
    WHERE i.id = $1
      AND u.firebase_uid = $2
    LIMIT 1
  `, [sessionId, firebaseUid]);

  return rows[0] ? serializeSessionRow(rows[0]) : null;
}

async function findActiveSession(firebaseUid) {
  const rows = await query(`
    SELECT
      i.*
    FROM interviews i
    JOIN app_users u ON u.id = i.user_id
    WHERE u.firebase_uid = $1
      AND i.status = 'in_progress'
    ORDER BY COALESCE(i.started_at, i.created_at) DESC
    LIMIT 1
  `, [firebaseUid]);

  return rows[0] ? serializeSessionRow(rows[0]) : null;
}

async function listSessionQuestions(interviewId) {
  const rows = await query(`
    SELECT *
    FROM interview_questions
    WHERE interview_id = $1
    ORDER BY sequence_number ASC
  `, [interviewId]);

  return rows.map(serializeQuestionRow);
}

async function saveGeneratedQuestions(interviewId, questions) {
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];

    await query(`
      INSERT INTO interview_questions (
        interview_id,
        prompt,
        category,
        difficulty,
        sequence_number,
        expected_focus,
        evaluation
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        COALESCE($6::jsonb, '[]'::jsonb),
        COALESCE($7::jsonb, '{}'::jsonb)
      )
    `, [
      interviewId,
      question.prompt,
      question.category,
      normalizeDifficulty(question.difficulty),
      index + 1,
      toJsonb([
        ...(question.evaluationFocus || []),
        ...(question.expectedSignals || []),
      ], null),
      toJsonb({
        friendlyLeadIn: question.friendlyLeadIn,
        answerStrategy: question.answerStrategy,
      }, null),
    ]);
  }
}

function mapSessionForClient(session, questions) {
  const answeredQuestions = questions.filter((question) => question.responseText).length;
  const currentQuestion = questions.find((question) => !question.responseText) || null;

  return {
    session: {
      id: session.id,
      title: session.title,
      role: session.role,
      company: session.company,
      interviewType: session.interviewType,
      difficulty: session.difficulty,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      totalQuestions: questions.length,
      answeredQuestions,
      intro: session.metadata.sessionIntro || '',
      focusAreas: session.metadata.focusAreas || [],
      mustCoverTopics: session.metadata.mustCoverTopics || [],
      experience: session.metadata.experience || '',
      interviewStage: session.metadata.interviewStage || '',
      answerStyle: session.metadata.answerStyle || '',
      jobDescription: session.metadata.jobDescription || '',
      companyContext: session.metadata.companyContext || '',
      interviewGoals: session.metadata.interviewGoals || '',
      resumeHighlights: session.metadata.resumeHighlights || '',
      recentProjects: session.metadata.recentProjects || '',
      difficultyMix: session.metadata.difficultyMix || [],
    },
    currentQuestion,
  };
}

async function buildQuestionPlan(firebaseUid, context) {
  const plan = await createStructuredResponse({
    model: GENERATION_MODEL,
    fallbackModel: GENERATION_FALLBACK_MODEL,
    instructions: 'You are TryInterview question generation engine.',
    input: buildInterviewPrompt(context),
    schemaName: 'interview_question_plan',
    schema: buildQuestionGenerationSchema(QUESTION_COUNT),
    safetyIdentifier: buildSafetyIdentifier(firebaseUid),
    reasoningEffort: REASONING_EFFORT,
    maxOutputTokens: 2200,
  });

  return sanitizeQuestionPlan(plan, context);
}

async function evaluateAnswer({ firebaseUid, session, question, answer }) {
  const evaluation = await createStructuredResponse({
    model: EVALUATION_MODEL,
    fallbackModel: EVALUATION_FALLBACK_MODEL,
    instructions: 'You are TryInterview answer evaluator.',
    input: buildEvaluationPrompt({ session, question, answer }),
    schemaName: 'interview_answer_evaluation',
    schema: ANSWER_EVALUATION_SCHEMA,
    safetyIdentifier: buildSafetyIdentifier(firebaseUid),
    reasoningEffort: REASONING_EFFORT,
    maxOutputTokens: 2200,
  });

  return normalizeAnswerEvaluation(evaluation);
}

function aggregateQuestionScores(questionRows) {
  const answeredQuestions = questionRows.filter((row) => row.responseText && row.evaluation?.dimensionScores);

  if (!answeredQuestions.length) {
    return {
      overallScore: 0,
      dimensionScores: {
        relevance: 0,
        clarity: 0,
        structure: 0,
        depth: 0,
        confidence: 0,
      },
    };
  }

  const totals = {
    relevance: 0,
    clarity: 0,
    structure: 0,
    depth: 0,
    confidence: 0,
  };

  let overallTotal = 0;

  answeredQuestions.forEach((row) => {
    overallTotal += normalizeNumber(row.evaluation.overallScore);
    SCORE_DIMENSIONS.forEach((dimension) => {
      totals[dimension] += normalizeNumber(row.evaluation.dimensionScores?.[dimension]);
    });
  });

  return {
    overallScore: Math.round(overallTotal / answeredQuestions.length),
    dimensionScores: SCORE_DIMENSIONS.reduce((accumulator, dimension) => ({
      ...accumulator,
      [dimension]: Math.round(totals[dimension] / answeredQuestions.length),
    }), {}),
  };
}

async function buildFinalFeedback({ firebaseUid, session, questionRows, aggregate }) {
  return createStructuredResponse({
    model: EVALUATION_MODEL,
    fallbackModel: EVALUATION_FALLBACK_MODEL,
    instructions: 'You are TryInterview final interview summarizer.',
    input: buildFinalSummaryPrompt({ session, questionRows, aggregate }),
    schemaName: 'interview_session_summary',
    schema: FINAL_FEEDBACK_SCHEMA,
    safetyIdentifier: buildSafetyIdentifier(firebaseUid),
    reasoningEffort: REASONING_EFFORT,
    maxOutputTokens: 1600,
  });
}

function buildTranscript(questionRows) {
  return questionRows.map((questionRow) => ({
    questionId: questionRow.id,
    sequenceNumber: questionRow.sequenceNumber,
    prompt: questionRow.prompt,
    difficulty: questionRow.difficulty,
    category: questionRow.category,
    answerStrategy: questionRow.answerStrategy,
    answer: questionRow.responseText,
    evaluation: questionRow.evaluation,
  }));
}

async function finalizeSession(firebaseUid, session) {
  const questionRows = await listSessionQuestions(session.id);
  const aggregate = aggregateQuestionScores(questionRows);
  const finalFeedback = await buildFinalFeedback({
    firebaseUid,
    session,
    questionRows,
    aggregate,
  });
  const transcript = buildTranscript(questionRows);
  const completedAt = new Date();
  const durationSeconds = Math.max(
    1,
    Math.round((completedAt.getTime() - new Date(session.startedAt || session.createdAt).getTime()) / 1000)
  );

  await query(`
    UPDATE interviews
    SET
      status = 'completed',
      completed_at = $2,
      duration_seconds = $3,
      overall_score = $4,
      summary = $5,
      transcript = COALESCE($6::jsonb, '[]'::jsonb),
      metadata = metadata || COALESCE($7::jsonb, '{}'::jsonb)
    WHERE id = $1
  `, [
    session.id,
    completedAt,
    durationSeconds,
    aggregate.overallScore,
    finalFeedback.summary,
    toJsonb(transcript, null),
    toJsonb({
      engineVersion: ENGINE_VERSION,
      completedAt: completedAt.toISOString(),
    }, null),
  ]);

  await saveInterviewFeedback(session.id, {
    overallScore: aggregate.overallScore,
    communicationScore: aggregate.dimensionScores.clarity,
    technicalScore: aggregate.dimensionScores.depth,
    confidenceScore: aggregate.dimensionScores.confidence,
    structureScore: aggregate.dimensionScores.structure,
    strengths: finalFeedback.strengths,
    improvements: finalFeedback.improvements,
    actionItems: finalFeedback.actionItems,
    summary: finalFeedback.summary,
    detailedFeedback: {
      readinessSignal: finalFeedback.readinessSignal,
      hiringSignal: finalFeedback.hiringSignal,
      nextMilestone: finalFeedback.nextMilestone,
      recommendedDrills: finalFeedback.recommendedDrills,
      dimensionScores: aggregate.dimensionScores,
      perQuestion: questionRows.map((questionRow) => ({
        id: questionRow.id,
        prompt: questionRow.prompt,
        evaluation: questionRow.evaluation,
      })),
    },
  });

  await grantAchievement(firebaseUid, 'first-interview', 100, {
    interviewId: session.id,
  });

  const milestoneResult = await applyInterviewMilestones(firebaseUid, session.id);
  const completedSession = await findSessionById(firebaseUid, session.id);
  const dashboardSnapshot = await getDashboardSnapshot(firebaseUid);

  await recordUserActivity(firebaseUid, {
    eventType: 'interview.session_completed',
    eventSource: 'engine',
    entityType: 'interview',
    entityId: session.id,
    payload: {
      overallScore: aggregate.overallScore,
      durationSeconds,
      interviewType: session.interviewType,
      role: session.role,
      certificateCode: milestoneResult.certificate?.certificateCode || null,
      currentStreak: milestoneResult.progress?.currentStreak ?? null,
      interviewsCompleted: milestoneResult.progress?.interviewsCompleted ?? null,
    },
  }, {
    snapshot: dashboardSnapshot,
  });

  return {
    completed: true,
    session: completedSession,
    finalFeedback: {
      ...finalFeedback,
      overallScore: aggregate.overallScore,
      dimensionScores: aggregate.dimensionScores,
      durationSeconds,
      transcript,
    },
    progress: milestoneResult.progress,
    certificate: milestoneResult.certificate,
  };
}

async function startInterviewSession(firebaseUid, payload = {}, identity = {}) {
  await ensureUser(firebaseUid, identity);

  const activeSession = await findActiveSession(firebaseUid);
  if (activeSession) {
    const activeQuestions = await listSessionQuestions(activeSession.id);
    await recordUserActivity(firebaseUid, {
      eventType: 'interview.session_resumed',
      eventSource: 'engine',
      entityType: 'interview',
      entityId: activeSession.id,
      payload: {
        interviewType: activeSession.interviewType,
        role: activeSession.role,
        answeredQuestions: activeQuestions.filter((question) => question.responseText).length,
        totalQuestions: activeQuestions.length,
      },
    });

    return {
      resumed: true,
      ...mapSessionForClient(activeSession, activeQuestions),
    };
  }

  const subscription = await findActiveSubscription(firebaseUid);
  const usage = await getUsageSummary(firebaseUid);
  const entitlements = buildEntitlements(subscription, usage);

  if (entitlements.interviewsRemaining !== null && entitlements.interviewsRemaining <= 0) {
    const error = new Error('You have reached the mock interview limit for your current plan.');
    error.code = 'INTERVIEW_LIMIT_REACHED';
    error.statusCode = 403;
    throw error;
  }

  const context = {
    role: normalizeTextValue(payload.role, {
      fallback: 'Interview Candidate',
      maxLength: MAX_ROLE_LENGTH,
    }),
    company: normalizeTextValue(payload.company, {
      fallback: '',
      maxLength: MAX_COMPANY_LENGTH,
    }),
    interviewStage: normalizeTextValue(payload.interviewStage, {
      fallback: 'Hiring manager',
      maxLength: MAX_STAGE_LENGTH,
    }),
    interviewType: normalizeInterviewType(payload.interviewType),
    difficulty: normalizeDifficulty(payload.difficulty),
    experience: normalizeTextValue(payload.experience, {
      fallback: 'Mid-level',
      maxLength: MAX_EXPERIENCE_LENGTH,
    }),
    answerStyle: normalizeTextValue(payload.answerStyle, {
      fallback: 'STAR + results',
      maxLength: MAX_ANSWER_STYLE_LENGTH,
    }),
    focusAreas: normalizeStringArray(payload.focusAreas, {
      maxItems: MAX_FOCUS_AREAS,
      maxItemLength: 48,
      fallback: [],
    }),
    mustCoverTopics: normalizeStringArray(payload.mustCoverTopics, {
      maxItems: MAX_MUST_COVER_TOPICS,
      maxItemLength: 56,
      fallback: [],
    }),
    jobDescription: normalizeTextValue(payload.jobDescription, {
      fallback: '',
      maxLength: MAX_JOB_DESCRIPTION_LENGTH,
    }),
    companyContext: normalizeTextValue(payload.companyContext, {
      fallback: '',
      maxLength: MAX_COMPANY_CONTEXT_LENGTH,
    }),
    interviewGoals: normalizeTextValue(payload.interviewGoals, {
      fallback: '',
      maxLength: MAX_INTERVIEW_GOALS_LENGTH,
    }),
    resumeHighlights: normalizeTextValue(payload.resumeHighlights, {
      fallback: '',
      maxLength: MAX_RESUME_HIGHLIGHTS_LENGTH,
    }),
    recentProjects: normalizeTextValue(payload.recentProjects, {
      fallback: '',
      maxLength: MAX_RECENT_PROJECTS_LENGTH,
    }),
  };
  const isFirstInterviewExperience = usage.totalInterviews === 0 && usage.completedInterviews === 0;

  const plan = await buildQuestionPlan(firebaseUid, context);
  const startedAt = new Date();
  const interview = await createInterview({
    userId: firebaseUid,
    title: `${capitalize(context.interviewType)} Interview - ${context.role}`,
    role: context.role,
    company: context.company || null,
    interviewType: context.interviewType,
    difficulty: context.difficulty,
    status: 'in_progress',
    startedAt,
    summary: 'Interview session in progress.',
    transcript: [],
    metadata: {
      engineVersion: ENGINE_VERSION,
      generationModel: GENERATION_MODEL,
      generationFallbackModel: GENERATION_FALLBACK_MODEL,
      evaluationModel: EVALUATION_MODEL,
      evaluationFallbackModel: EVALUATION_FALLBACK_MODEL,
      sessionIntro: buildSessionGreeting(isFirstInterviewExperience),
      planIntro: plan.sessionIntro,
      greetingVariant: isFirstInterviewExperience ? 'first_interview' : 'returning_interview',
      experience: context.experience,
      focusAreas: context.focusAreas,
      mustCoverTopics: context.mustCoverTopics,
      interviewStage: context.interviewStage,
      answerStyle: context.answerStyle,
      jobDescription: context.jobDescription,
      companyContext: context.companyContext,
      interviewGoals: context.interviewGoals,
      resumeHighlights: context.resumeHighlights,
      recentProjects: context.recentProjects,
      difficultyMix: buildDifficultyMix(context.difficulty, QUESTION_COUNT),
    },
  });

  await saveGeneratedQuestions(interview.id, plan.questions);
  const session = await findSessionById(firebaseUid, interview.id);
  const questions = await listSessionQuestions(interview.id);

  await recordUserActivity(firebaseUid, {
    eventType: 'interview.session_started',
    eventSource: 'engine',
    entityType: 'interview',
    entityId: interview.id,
    payload: {
      interviewType: context.interviewType,
      difficulty: context.difficulty,
      role: context.role,
      company: context.company || null,
      totalQuestions: questions.length,
      focusAreas: context.focusAreas,
    },
  });

  return {
    resumed: false,
    ...mapSessionForClient(session, questions),
    entitlements: buildEntitlements(subscription, {
      ...usage,
      totalInterviews: usage.totalInterviews + 1,
      monthInterviews: usage.monthInterviews + 1,
    }),
  };
}

async function submitInterviewAnswer(firebaseUid, payload = {}) {
  const session = await findSessionById(firebaseUid, payload.sessionId);

  if (!session) {
    const error = new Error('Interview session not found.');
    error.statusCode = 404;
    throw error;
  }

  if (session.status === 'completed') {
    return {
      completed: true,
      session,
      currentQuestion: null,
    };
  }

  const questionRows = await listSessionQuestions(session.id);
  const currentQuestion = questionRows.find((question) => !question.responseText);

  if (!currentQuestion) {
    return finalizeSession(firebaseUid, session);
  }

  const answer = String(payload.answer || '').trim();

  if (!answer) {
    const error = new Error('Answer text is required.');
    error.statusCode = 400;
    throw error;
  }

  if (answer.length > MAX_ANSWER_LENGTH) {
    const error = new Error(`Answer is too long. Please keep each response under ${MAX_ANSWER_LENGTH} characters.`);
    error.statusCode = 400;
    throw error;
  }

  if (payload.questionId && String(payload.questionId) !== String(currentQuestion.id)) {
    const error = new Error('This question is no longer active. Please answer the current interview prompt.');
    error.statusCode = 409;
    throw error;
  }

  const evaluation = await evaluateAnswer({
    firebaseUid,
    session,
    question: currentQuestion,
    answer,
  });

  const normalizedResponseDuration = payload.responseDurationSeconds === null || payload.responseDurationSeconds === undefined
    ? null
    : Math.max(1, Math.min(7200, Math.round(normalizeNumber(payload.responseDurationSeconds))));

  await query(`
    UPDATE interview_questions
    SET
      response_text = $3,
      response_duration_seconds = $4,
      evaluation = COALESCE($5::jsonb, '{}'::jsonb)
    WHERE interview_id = $1
      AND id = $2
  `, [
    session.id,
    currentQuestion.id,
    answer,
    normalizedResponseDuration,
    toJsonb(evaluation, null),
  ]);

  const updatedQuestionRows = await listSessionQuestions(session.id);
  const nextQuestion = updatedQuestionRows.find((question) => !question.responseText);

  if (!nextQuestion) {
    const finalResult = await finalizeSession(firebaseUid, session);
    const evaluationResponse = buildEvaluationResponse(
      currentQuestion,
      answer,
      evaluation,
      normalizedResponseDuration
    );

    return {
      ...finalResult,
      evaluation: evaluationResponse,
      currentQuestion: null,
    };
  }

  const evaluationResponse = buildEvaluationResponse(
    currentQuestion,
    answer,
    evaluation,
    normalizedResponseDuration
  );

  return {
    completed: false,
    session: {
      ...session,
      answeredQuestions: updatedQuestionRows.filter((question) => question.responseText).length,
      totalQuestions: updatedQuestionRows.length,
      intro: session.metadata.sessionIntro || '',
      focusAreas: session.metadata.focusAreas || [],
      experience: session.metadata.experience || '',
      difficultyMix: session.metadata.difficultyMix || [],
    },
    evaluation: evaluationResponse,
    currentQuestion: nextQuestion,
  };
}

module.exports = {
  ENGINE_VERSION,
  SCORE_DIMENSIONS,
  startInterviewSession,
  submitInterviewAnswer,
};
