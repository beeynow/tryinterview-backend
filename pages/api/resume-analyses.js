const {
  createCors,
  getIdentityFromToken,
  requireAuth,
  runMiddleware,
} = require('../../lib/apiUtils');
const {
  analyzeResumeSubmission,
  getUsageSummary,
  listResumeAnalysisHistory,
} = require('../../lib/platformStore');
const {
  buildEntitlements,
} = require('../../lib/planConfig');
const {
  findActiveSubscription,
} = require('../../lib/postgresStore');

const cors = createCors(['GET', 'POST', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  const identity = getIdentityFromToken(authUser);

  if (req.method === 'GET') {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
      const [items, subscription, usage] = await Promise.all([
        listResumeAnalysisHistory(identity.userId, limit),
        findActiveSubscription(identity.userId),
        getUsageSummary(identity.userId),
      ]);

      return res.status(200).json({
        items,
        entitlements: buildEntitlements(subscription, usage),
      });
    } catch (error) {
      console.error('Error loading resume analyses:', error);
      return res.status(error.statusCode || 500).json({
        error: 'Failed to load resume analyses',
        message: error.message,
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const payload = req.body || {};
      const result = await analyzeResumeSubmission(identity.userId, payload, identity);
      const [subscription, usage] = await Promise.all([
        findActiveSubscription(identity.userId),
        getUsageSummary(identity.userId),
      ]);

      return res.status(201).json({
        success: true,
        ...result,
        entitlements: buildEntitlements(subscription, usage),
      });
    } catch (error) {
      console.error('Error creating resume analysis:', error);
      return res.status(error.statusCode || 500).json({
        error: 'Failed to analyze resume',
        message: error.message,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
