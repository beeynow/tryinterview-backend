const {
  createCors,
  enforceRouteRateLimit,
  getIdentityFromToken,
  requireAuth,
  requireJsonRequest,
  runMiddleware,
  setApiSecurityHeaders,
} = require('../../../lib/apiUtils');
const {
  startInterviewSession,
} = require('../../../lib/interviewEngine');

const cors = createCors(['POST', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);
  setApiSecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireJsonRequest(req, res)) {
    return;
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  try {
    const identity = getIdentityFromToken(authUser);
    if (!enforceRouteRateLimit(req, res, {
      scope: 'interview-engine-start',
      limit: Number(process.env.INTERVIEW_ENGINE_START_LIMIT || 5),
      windowMs: Number(process.env.INTERVIEW_ENGINE_START_WINDOW_MS || 600000),
      identifier: identity.userId,
    })) {
      return;
    }
    const result = await startInterviewSession(identity.userId, req.body || {}, identity);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error starting interview engine session:', error);
    return res.status(error.statusCode || 500).json({
      error: error.code === 'INTERVIEW_LIMIT_REACHED'
        ? 'Interview limit reached'
        : 'Failed to start interview session',
      message: error.message,
      code: error.code || null,
    });
  }
}
