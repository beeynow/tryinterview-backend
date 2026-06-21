const {
  createCors,
  enforceRouteRateLimit,
  requireJsonRequest,
  runMiddleware,
  setApiSecurityHeaders,
} = require('../../../../lib/apiUtils');
const { createVerifiedEmailAccount, normalizeEmail } = require('../../../../lib/emailOtpService');

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

  if (!enforceRouteRateLimit(req, res, {
    scope: 'email-otp:complete:ip',
    limit: 12,
    windowMs: 10 * 60 * 1000,
  })) {
    return;
  }

  let emailIdentifier = null;
  try {
    emailIdentifier = normalizeEmail(req.body?.email);
  } catch (_error) {
    emailIdentifier = String(req.body?.email || 'invalid').trim().toLowerCase().slice(0, 254);
  }

  if (!enforceRouteRateLimit(req, res, {
    scope: 'email-otp:complete:email',
    limit: 8,
    windowMs: 10 * 60 * 1000,
    identifier: emailIdentifier || 'unknown',
  })) {
    return;
  }

  try {
    const result = await createVerifiedEmailAccount({
      email: req.body?.email,
      password: req.body?.password,
      code: req.body?.code,
    });

    return res.status(200).json({
      success: true,
      customToken: result.customToken,
      user: result.user,
    });
  } catch (error) {
    console.error('Failed to complete email OTP signup:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Signup verification failed',
      message: error.message || 'Unable to verify code and create account.',
      attemptsRemaining: error.attemptsRemaining,
    });
  }
}
