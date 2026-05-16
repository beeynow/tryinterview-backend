const {
  createCors,
  enforceRouteRateLimit,
  getIdentityFromToken,
  requireAuth,
  runMiddleware,
  setApiSecurityHeaders,
} = require('../../lib/apiUtils');
const {
  getDashboardSnapshot,
} = require('../../lib/platformStore');

const cors = createCors(['GET', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);
  setApiSecurityHeaders(res);

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

  try {
    const identity = getIdentityFromToken(authUser);
    if (!enforceRouteRateLimit(req, res, {
      scope: 'dashboard:get',
      limit: 30,
      windowMs: 60000,
      identifier: identity.userId,
    })) {
      return;
    }
    const dashboard = await getDashboardSnapshot(identity.userId, identity);

    return res.status(200).json(dashboard);
  } catch (error) {
    console.error('Error loading dashboard:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to load dashboard',
      message: error.message,
    });
  }
}
