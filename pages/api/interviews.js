const {
  createCors,
  enforceRouteRateLimit,
  getIdentityFromToken,
  requireAuth,
  requireJsonRequest,
  runMiddleware,
  setApiSecurityHeaders,
} = require('../../lib/apiUtils');
const {
  createMockInterviewSession,
  getDashboardSnapshot,
} = require('../../lib/platformStore');
const {
  listInterviewHistory,
} = require('../../lib/postgresStore');

const cors = createCors(['GET', 'POST', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);
  setApiSecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!requireJsonRequest(req, res)) {
    return;
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  const identity = getIdentityFromToken(authUser);

  if (!enforceRouteRateLimit(req, res, {
    scope: `interviews:${req.method.toLowerCase()}`,
    limit: req.method === 'GET' ? 30 : 10,
    windowMs: 60000,
    identifier: identity.userId,
  })) {
    return;
  }

  if (req.method === 'GET') {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      const items = await listInterviewHistory(identity.userId, limit);
      return res.status(200).json({ items });
    } catch (error) {
      console.error('Error loading interviews:', error);
      return res.status(error.statusCode || 500).json({
        error: 'Failed to load interviews',
        message: error.message,
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const payload = req.body || {};
      const result = await createMockInterviewSession(identity.userId, payload, identity);
      const dashboard = await getDashboardSnapshot(identity.userId, identity);

      return res.status(201).json({
        success: true,
        ...result,
        dashboard,
      });
    } catch (error) {
      console.error('Error creating interview:', error);
      return res.status(error.statusCode || 500).json({
        error: error.code === 'INTERVIEW_LIMIT_REACHED'
          ? 'Interview limit reached'
          : 'Failed to create interview',
        message: error.message,
        code: error.code || null,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
