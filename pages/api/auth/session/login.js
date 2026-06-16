const { admin, initializeFirebase } = require('../../../../lib/firebaseAdmin');
const { createCors, runMiddleware } = require('../../../../lib/apiUtils');
const { createServerSession, validateCsrfRequest } = require('../../../../lib/sessionStore');

const cors = createCors(['POST', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!validateCsrfRequest(req)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'A valid CSRF token is required.',
    });
  }

  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    initializeFirebase();

    if (!admin.apps.length) {
      throw new Error('Firebase Admin is not initialized');
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const session = await createServerSession({
      req,
      res,
      idToken,
      decodedToken,
    });

    return res.status(200).json({
      success: true,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      hasDatabaseSession: session.hasDatabaseSession,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
        name: decodedToken.name || null,
      },
    });
  } catch (error) {
    console.error('❌ Failed to create session:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: error.message || 'Unable to create a secure session.',
    });
  }
}
