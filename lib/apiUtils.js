const Cors = require('cors');
const { admin, initializeFirebase } = require('./firebaseAdmin');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://tryinterview.site',
  'https://www.tryinterview.site',
];

function getAllowedOrigins() {
  const configuredOrigin = process.env.FRONTEND_URL;
  if (!configuredOrigin) return DEFAULT_ALLOWED_ORIGINS;

  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, configuredOrigin]));
}

function createCors(methods) {
  const allowedOrigins = getAllowedOrigins();

  return Cors({
    methods,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origin not allowed by CORS'));
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
    optionsSuccessStatus: 200,
  });
}

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }

      return resolve(result);
    });
  });
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim();
}

function getUnauthorizedMessage(error) {
  switch (error?.code) {
    case 'auth/id-token-expired':
      return 'Your session has expired. Please sign in again.';
    case 'auth/id-token-revoked':
      return 'Your session has been revoked. Please sign in again.';
    case 'auth/argument-error':
      return 'A valid bearer token is required.';
    default:
      return 'Authentication is required.';
  }
}

async function requireAuth(req, res) {
  try {
    initializeFirebase();

    if (!admin.apps.length) {
      throw new Error('Firebase Admin is not initialized');
    }

    const token = getBearerToken(req);

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }

    return await admin.auth().verifyIdToken(token, true);
  } catch (error) {
    console.error('❌ Auth verification failed:', error.message);
    res.status(401).json({
      error: 'Unauthorized',
      message: getUnauthorizedMessage(error),
    });
    return null;
  }
}

function getIdentityFromToken(decodedToken) {
  return {
    userId: decodedToken.uid,
    email: decodedToken.email || null,
    name: decodedToken.name || null,
    photoURL: decodedToken.picture || null,
    provider: decodedToken.firebase?.sign_in_provider || null,
  };
}

module.exports = {
  createCors,
  runMiddleware,
  requireAuth,
  getIdentityFromToken,
};
