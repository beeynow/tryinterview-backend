const crypto = require('crypto');
const { admin, initializeFirebase } = require('./firebaseAdmin');
const {
  canUsePostgresStore,
  createAuthSession,
  findValidAuthSession,
  revokeAuthSession,
  touchAuthSession,
  upsertUser,
} = require('./postgresStore');
const {
  CSRF_COOKIE_NAME,
  FIREBASE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  generateOpaqueToken,
  getCookieConfig,
  getRequestIp,
  getUserAgent,
  parseCookies,
  setCookie,
} = require('./sessionSecurity');

const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 5);
const RECENT_SIGN_IN_WINDOW_SECONDS = Number(process.env.RECENT_SIGN_IN_WINDOW_SECONDS || 5 * 60);
const ENFORCE_RECENT_SIGN_IN_FOR_SESSION = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.REQUIRE_RECENT_SIGN_IN_FOR_SESSION || '').trim().toLowerCase()
);

function safeCompareStrings(a, b) {
  if (!a || !b) {
    return false;
  }

  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function getSessionExpiryDate() {
  return new Date(Date.now() + SESSION_MAX_AGE_MS);
}

function getCookieMaxAgeSeconds() {
  return Math.floor(SESSION_MAX_AGE_MS / 1000);
}

function getSessionCookies(req) {
  const cookies = parseCookies(req);
  return {
    csrfToken: cookies[CSRF_COOKIE_NAME] || null,
    firebaseSessionCookie: cookies[FIREBASE_SESSION_COOKIE_NAME] || null,
    sessionToken: cookies[SESSION_COOKIE_NAME] || null,
  };
}

function setPublicCsrfCookie(res, csrfToken) {
  setCookie(res, CSRF_COOKIE_NAME, csrfToken, {
    ...getCookieConfig({
      httpOnly: false,
      maxAge: getCookieMaxAgeSeconds(),
    }),
  });
}

function clearSessionResponseCookies(res) {
  clearCookie(res, CSRF_COOKIE_NAME, {
    httpOnly: false,
  });
  clearCookie(res, SESSION_COOKIE_NAME);
  clearCookie(res, FIREBASE_SESSION_COOKIE_NAME);
}

function assertRecentSignIn(decodedToken) {
  if (!ENFORCE_RECENT_SIGN_IN_FOR_SESSION) {
    return;
  }

  const authTimeSeconds = decodedToken?.auth_time;

  if (!authTimeSeconds) {
    throw new Error('Recent sign-in is required before creating a session.');
  }

  const authAgeSeconds = Math.floor(Date.now() / 1000) - Number(authTimeSeconds);
  if (authAgeSeconds > RECENT_SIGN_IN_WINDOW_SECONDS) {
    throw new Error('Recent sign-in is required before creating a session.');
  }
}

async function createCsrfHandshake(res) {
  const csrfToken = generateOpaqueToken(24);
  setPublicCsrfCookie(res, csrfToken);
  return csrfToken;
}

function validateCsrfRequest(req) {
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken =
    req?.headers?.['x-csrf-token'] ||
    req?.headers?.['X-CSRF-Token'] ||
    req?.body?.csrfToken ||
    null;

  return safeCompareStrings(cookieToken, headerToken);
}

async function createServerSession({ req, res, idToken, decodedToken }) {
  initializeFirebase();

  if (!admin.apps.length) {
    throw new Error('Firebase Admin is not initialized.');
  }

  assertRecentSignIn(decodedToken);

  const expiresAt = getSessionExpiryDate();
  const firebaseSessionCookie = await admin.auth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  if (canUsePostgresStore()) {
    await upsertUser({
      userId: decodedToken.uid,
      email: decodedToken.email || null,
      emailVerified: decodedToken.email_verified || false,
      name: decodedToken.name || null,
      photoURL: decodedToken.picture || null,
      provider: decodedToken.firebase?.sign_in_provider || null,
      lastLoginAt: new Date(),
      metadata: {
        sessionBootstrapAt: new Date().toISOString(),
      },
    });
  }

  const csrfToken = generateOpaqueToken(24);
  const sessionToken = canUsePostgresStore() ? generateOpaqueToken(48) : null;

  if (sessionToken) {
    await createAuthSession({
      userId: decodedToken.uid,
      sessionToken,
      csrfToken,
      firebaseSessionExpiresAt: expiresAt,
      expiresAt,
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
      metadata: {
        signInProvider: decodedToken.firebase?.sign_in_provider || null,
      },
    });

    setCookie(res, SESSION_COOKIE_NAME, sessionToken, {
      maxAge: getCookieMaxAgeSeconds(),
    });
  }

  setCookie(res, FIREBASE_SESSION_COOKIE_NAME, firebaseSessionCookie, {
    maxAge: getCookieMaxAgeSeconds(),
  });
  setPublicCsrfCookie(res, csrfToken);

  return {
    csrfToken,
    expiresAt,
    hasDatabaseSession: Boolean(sessionToken),
  };
}

async function getAuthenticatedSession(req) {
  initializeFirebase();

  if (!admin.apps.length) {
    return null;
  }

  const { firebaseSessionCookie, sessionToken } = getSessionCookies(req);
  if (!firebaseSessionCookie) {
    return null;
  }

  const decodedToken = await admin.auth().verifySessionCookie(firebaseSessionCookie);

  if (!canUsePostgresStore()) {
    return {
      authType: 'session',
      decodedToken,
      session: null,
    };
  }

  if (!sessionToken) {
    return null;
  }

  const session = await findValidAuthSession(sessionToken);
  if (!session || session.userId !== decodedToken.uid) {
    return null;
  }

  await touchAuthSession(sessionToken);

  return {
    authType: 'session',
    decodedToken,
    session,
  };
}

async function destroyServerSession(req, res) {
  const { sessionToken } = getSessionCookies(req);

  if (sessionToken && canUsePostgresStore()) {
    await revokeAuthSession(sessionToken);
  }

  clearSessionResponseCookies(res);
}

module.exports = {
  CSRF_COOKIE_NAME,
  FIREBASE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  createCsrfHandshake,
  createServerSession,
  destroyServerSession,
  getAuthenticatedSession,
  getSessionCookies,
  validateCsrfRequest,
};
