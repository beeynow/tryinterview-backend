const Cors = require('cors');
const { admin, initializeFirebase } = require('./firebaseAdmin');
const { getAuthenticatedSession } = require('./sessionStore');
const { getRequestIp } = require('./sessionSecurity');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://tryinterview.site',
  'https://www.tryinterview.site',
  'https://tryinterviews.site',
  'https://www.tryinterviews.site',
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
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature', 'X-CSRF-Token'],
    credentials: true,
    optionsSuccessStatus: 200,
  });
}

const routeRateLimitBuckets = new Map();

function setApiSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function requireJsonRequest(req, res) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return true;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    res.status(415).json({
      error: 'Unsupported media type',
      message: 'This endpoint only accepts application/json requests.',
    });
    return false;
  }

  return true;
}

function normalizePositiveNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function pruneExpiredRateLimitEntries(now) {
  for (const [key, bucket] of routeRateLimitBuckets.entries()) {
    if (!bucket.resetAt || bucket.resetAt <= now) {
      routeRateLimitBuckets.delete(key);
    }
  }
}

function enforceRouteRateLimit(req, res, {
  scope = 'api',
  limit = 10,
  windowMs = 60000,
  identifier = null,
} = {}) {
  const now = Date.now();
  const normalizedLimit = normalizePositiveNumber(limit, 10);
  const normalizedWindowMs = normalizePositiveNumber(windowMs, 60000);

  pruneExpiredRateLimitEntries(now);

  const subject = identifier || getRequestIp(req) || 'anonymous';
  const key = `${scope}:${subject}`;
  const currentBucket = routeRateLimitBuckets.get(key);
  const bucket = currentBucket && currentBucket.resetAt > now
    ? currentBucket
    : { count: 0, resetAt: now + normalizedWindowMs };

  bucket.count += 1;
  routeRateLimitBuckets.set(key, bucket);

  const remaining = Math.max(normalizedLimit - bucket.count, 0);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  res.setHeader('RateLimit-Limit', String(normalizedLimit));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > normalizedLimit) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please wait a moment before trying again.',
      retryAfterSeconds,
    });
    return false;
  }

  return true;
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
    case 'auth/session-cookie-expired':
      return 'Your session has expired. Please sign in again.';
    case 'auth/id-token-revoked':
    case 'auth/session-cookie-revoked':
      return 'Your session has been revoked. Please sign in again.';
    case 'auth/invalid-session-cookie':
    case 'auth/argument-error':
      return 'A valid bearer token is required.';
    default:
      return error?.message || 'Authentication is required.';
  }
}

async function requireAuth(req, res) {
  try {
    initializeFirebase();

    if (!admin.apps.length) {
      throw new Error('Firebase Admin is not initialized');
    }

    const token = getBearerToken(req);

    if (token) {
      try {
        return await admin.auth().verifyIdToken(token);
      } catch (tokenError) {
        try {
          const authenticatedSession = await getAuthenticatedSession(req);
          if (authenticatedSession?.decodedToken) {
            return authenticatedSession.decodedToken;
          }
        } catch (sessionError) {
          console.warn('Session auth fallback failed after bearer rejection:', sessionError.message);
        }

        throw tokenError;
      }
    }

    const authenticatedSession = await getAuthenticatedSession(req);
    if (authenticatedSession?.decodedToken) {
      return authenticatedSession.decodedToken;
    }

    res.status(401).json({ error: 'Authentication required' });
    return null;
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
  enforceRouteRateLimit,
  getBearerToken,
  getIdentityFromToken,
  requireAuth,
  requireJsonRequest,
  runMiddleware,
  setApiSecurityHeaders,
};
