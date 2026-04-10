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
  submitInterviewAnswer,
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
      scope: 'interview-engine-respond',
      limit: Number(process.env.INTERVIEW_ENGINE_ANSWER_LIMIT || 30),
      windowMs: Number(process.env.INTERVIEW_ENGINE_ANSWER_WINDOW_MS || 600000),
      identifier: identity.userId,
    })) {
      return;
    }
    const result = await submitInterviewAnswer(identity.userId, req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error evaluating interview answer:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to evaluate interview answer',
      message: error.message,
    });
  }
}
