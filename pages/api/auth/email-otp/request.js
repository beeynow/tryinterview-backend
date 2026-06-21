const {
  createCors,
  enforceRouteRateLimit,
  requireJsonRequest,
  runMiddleware,
  setApiSecurityHeaders,
} = require('../../../../lib/apiUtils');
const { issueSignupOtp, normalizeEmail } = require('../../../../lib/emailOtpService');

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
    scope: 'email-otp:request:ip',
    limit: 8,
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
    scope: 'email-otp:request:email',
    limit: 4,
    windowMs: 15 * 60 * 1000,
    identifier: emailIdentifier || 'unknown',
  })) {
    return;
  }

  try {
    const result = await issueSignupOtp({
      email: req.body?.email,
      req,
    });

    return res.status(200).json({
      success: true,
      email: result.email,
      expiresAt: result.expiresAt,
      expiresInSeconds: result.expiresInSeconds,
      resendAfterSeconds: result.resendAfterSeconds,
      deliveryProvider: result.deliveryProvider,
    });
  } catch (error) {
    console.error('Failed to issue email signup OTP:', error);
    return res.status(error.statusCode || 500).json({
      error: 'OTP request failed',
      message: error.message || 'Unable to send verification code.',
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
}
