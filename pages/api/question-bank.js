const {
  createCors,
  getIdentityFromToken,
  requireAuth,
  runMiddleware,
} = require('../../lib/apiUtils');
const {
  buildEntitlements,
} = require('../../lib/planConfig');
const {
  getUsageSummary,
  listQuestionBankCategories,
  listQuestionBankItems,
} = require('../../lib/platformStore');
const {
  findActiveSubscription,
} = require('../../lib/postgresStore');

const cors = createCors(['GET', 'OPTIONS']);

function getLimitForAccess(questionBankAccess, requestedLimit) {
  const normalizedLimit = Math.min(Math.max(Number(requestedLimit) || 12, 1), 100);

  if (questionBankAccess === 'full') {
    return normalizedLimit;
  }

  if (questionBankAccess === 'starter') {
    return Math.min(normalizedLimit, 25);
  }

  return Math.min(normalizedLimit, 6);
}

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  const identity = getIdentityFromToken(authUser);

  try {
    const [subscription, usage, categories] = await Promise.all([
      findActiveSubscription(identity.userId),
      getUsageSummary(identity.userId),
      listQuestionBankCategories(),
    ]);

    const entitlements = buildEntitlements(subscription, usage);
    const items = await listQuestionBankItems({
      category: req.query.category,
      difficulty: req.query.difficulty,
      interviewType: req.query.interviewType,
      search: req.query.search,
      limit: getLimitForAccess(entitlements.questionBankAccess, req.query.limit),
    });

    return res.status(200).json({
      categories,
      items,
      totalQuestions: categories.reduce((sum, category) => sum + category.count, 0),
      entitlements,
    });
  } catch (error) {
    console.error('Error loading question bank:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to load question bank',
      message: error.message,
    });
  }
}
