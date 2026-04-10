const FREE_PLAN_ID = 'free';

const PLAN_DEFINITIONS = {
  free: {
    key: 'free',
    id: FREE_PLAN_ID,
    name: 'Free',
    trialMockInterviews: 1,
    monthlyMockInterviews: 1,
    questionBankAccess: 'preview',
    resumeAnalysesPerMonth: 0,
    prioritySupport: false,
  },
  starter: {
    key: 'starter',
    id: process.env.STRIPE_PRICE_STARTER || 'starter',
    name: 'Starter',
    trialMockInterviews: 0,
    monthlyMockInterviews: 5,
    questionBankAccess: 'starter',
    resumeAnalysesPerMonth: 1,
    prioritySupport: false,
  },
  professional: {
    key: 'professional',
    id: process.env.STRIPE_PRICE_PROFESSIONAL || 'professional',
    name: 'Professional',
    trialMockInterviews: 0,
    monthlyMockInterviews: null,
    questionBankAccess: 'full',
    resumeAnalysesPerMonth: null,
    prioritySupport: true,
  },
  premium: {
    key: 'premium',
    id: process.env.STRIPE_PRICE_PREMIUM || 'premium',
    name: 'Premium',
    trialMockInterviews: 0,
    monthlyMockInterviews: null,
    questionBankAccess: 'full',
    resumeAnalysesPerMonth: null,
    prioritySupport: true,
  },
};

function normalizeValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function findPlanKeyByPriceId(priceId) {
  const normalizedPriceId = normalizeValue(priceId);

  return Object.values(PLAN_DEFINITIONS).find((plan) => (
    plan.key !== 'free' && normalizeValue(plan.id) === normalizedPriceId
  ))?.key || null;
}

function findPlanKeyByName(planName) {
  const normalizedPlanName = normalizeValue(planName);

  return Object.values(PLAN_DEFINITIONS).find((plan) => (
    normalizeValue(plan.name) === normalizedPlanName
  ))?.key || null;
}

function getPlanDefinition(planKey = 'free') {
  return PLAN_DEFINITIONS[planKey] || PLAN_DEFINITIONS.free;
}

function resolvePlanDefinition(subscription = null) {
  if (!subscription || subscription.status !== 'active') {
    return PLAN_DEFINITIONS.free;
  }

  const keyFromPriceId = findPlanKeyByPriceId(subscription.priceId || subscription.price_id);
  if (keyFromPriceId) {
    return getPlanDefinition(keyFromPriceId);
  }

  const keyFromPlanName = findPlanKeyByName(subscription.planName || subscription.plan_name);
  if (keyFromPlanName) {
    return getPlanDefinition(keyFromPlanName);
  }

  return PLAN_DEFINITIONS.free;
}

function buildEntitlements(subscription = null, usage = {}) {
  const plan = resolvePlanDefinition(subscription);
  const totalInterviews = Number(usage.totalInterviews || 0);
  const monthInterviews = Number(usage.monthInterviews || 0);
  const completedInterviews = Number(usage.completedInterviews || 0);
  const monthResumeAnalyses = Number(usage.monthResumeAnalyses || 0);

  const interviewLimit = plan.monthlyMockInterviews;
  const consumedInterviewCount = plan.key === 'free'
    ? completedInterviews
    : monthInterviews;
  const interviewsRemaining = interviewLimit === null
    ? null
    : Math.max(interviewLimit - consumedInterviewCount, 0);

  const resumeLimit = plan.resumeAnalysesPerMonth;
  const resumeAnalysesRemaining = resumeLimit === null
    ? null
    : Math.max(resumeLimit - monthResumeAnalyses, 0);

  return {
    planKey: plan.key,
    planName: plan.name,
    trialMockInterviews: plan.trialMockInterviews,
    monthlyMockInterviews: plan.monthlyMockInterviews,
    questionBankAccess: plan.questionBankAccess,
    resumeAnalysesPerMonth: plan.resumeAnalysesPerMonth,
    prioritySupport: plan.prioritySupport,
    totalInterviews,
    monthInterviews,
    completedInterviews,
    monthResumeAnalyses,
    interviewsRemaining,
    resumeAnalysesRemaining,
    isFreePlan: plan.key === 'free',
  };
}

module.exports = {
  FREE_PLAN_ID,
  PLAN_DEFINITIONS,
  buildEntitlements,
  getPlanDefinition,
  resolvePlanDefinition,
};
