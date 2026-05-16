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
  getUserProfileSnapshot,
  saveUserProfile,
} = require('../../lib/platformStore');

const cors = createCors(['GET', 'POST', 'PUT', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);
  setApiSecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!['GET', 'POST', 'PUT'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
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
    scope: `user-profile:${req.method.toLowerCase()}`,
    limit: req.method === 'GET' ? 30 : 12,
    windowMs: 60000,
    identifier: identity.userId,
  })) {
    return;
  }

  if (req.method === 'GET') {
    try {
      const snapshot = await getUserProfileSnapshot(identity.userId, identity);
      return res.status(200).json(snapshot);
    } catch (error) {
      console.error('Error getting profile:', error);
      return res.status(error.statusCode || 500).json({
        error: 'Failed to get profile',
        message: error.message,
      });
    }
  }

  try {
    const snapshot = await saveUserProfile(identity.userId, req.body || {}, identity);

    return res.status(200).json({
      success: true,
      ...snapshot,
    });
  } catch (error) {
    console.error('Error saving profile:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to save profile',
      message: error.message,
    });
  }
}
