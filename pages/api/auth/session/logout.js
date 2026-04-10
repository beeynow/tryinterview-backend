const {
  createCors,
  getBearerToken,
  runMiddleware,
} = require('../../../../lib/apiUtils');
const { destroyServerSession, validateCsrfRequest } = require('../../../../lib/sessionStore');

const cors = createCors(['POST', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const hasBearerToken = Boolean(getBearerToken(req));
  if (!hasBearerToken && !validateCsrfRequest(req)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'A valid CSRF token is required.',
    });
  }

  try {
    await destroyServerSession(req, res);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Failed to destroy session:', error);
    return res.status(500).json({
      error: 'Failed to destroy session',
      message: error.message,
    });
  }
}
