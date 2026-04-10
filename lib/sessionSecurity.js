const crypto = require('crypto');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'ti_session';
const FIREBASE_SESSION_COOKIE_NAME = process.env.FIREBASE_SESSION_COOKIE_NAME || '__session';
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'ti_csrf';
const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;
const SESSION_COOKIE_PATH = process.env.SESSION_COOKIE_PATH || '/';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_SAME_SITE = (
  process.env.SESSION_COOKIE_SAME_SITE ||
  (IS_PRODUCTION ? 'None' : 'Lax')
).toLowerCase();

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateOpaqueToken(size = 48) {
  return toBase64Url(crypto.randomBytes(size));
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashOptionalValue(value) {
  if (!value) {
    return null;
  }

  return hashToken(value);
}

function getCookieConfig(overrides = {}) {
  return {
    domain: SESSION_COOKIE_DOMAIN,
    httpOnly: true,
    maxAge: undefined,
    path: SESSION_COOKIE_PATH,
    sameSite: SESSION_COOKIE_SAME_SITE,
    secure: IS_PRODUCTION || SESSION_COOKIE_SAME_SITE === 'none',
    ...overrides,
  };
}

function formatCookieValue(name, value, options = {}) {
  const config = getCookieConfig(options);
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (typeof config.maxAge === 'number') {
    parts.push(`Max-Age=${Math.floor(config.maxAge)}`);
  }

  if (config.domain) {
    parts.push(`Domain=${config.domain}`);
  }

  if (config.path) {
    parts.push(`Path=${config.path}`);
  }

  if (config.secure) {
    parts.push('Secure');
  }

  if (config.httpOnly) {
    parts.push('HttpOnly');
  }

  if (config.sameSite) {
    const normalizedSameSite = config.sameSite.charAt(0).toUpperCase() + config.sameSite.slice(1);
    parts.push(`SameSite=${normalizedSameSite}`);
  }

  return parts.join('; ');
}

function parseCookies(req) {
  const cookieHeader = req?.headers?.cookie || '';
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function appendSetCookie(res, value) {
  const currentValue = res.getHeader('Set-Cookie');

  if (!currentValue) {
    res.setHeader('Set-Cookie', [value]);
    return;
  }

  const existingValues = Array.isArray(currentValue) ? currentValue : [currentValue];
  res.setHeader('Set-Cookie', [...existingValues, value]);
}

function setCookie(res, name, value, options) {
  appendSetCookie(res, formatCookieValue(name, value, options));
}

function clearCookie(res, name, options = {}) {
  setCookie(res, name, '', {
    ...options,
    maxAge: 0,
  });
}

function getRequestIp(req) {
  const forwardedFor = req?.headers?.['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    req?.headers?.['x-real-ip'] ||
    req?.socket?.remoteAddress ||
    null
  );
}

function getUserAgent(req) {
  return req?.headers?.['user-agent'] || null;
}

module.exports = {
  CSRF_COOKIE_NAME,
  FIREBASE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  formatCookieValue,
  generateOpaqueToken,
  getCookieConfig,
  getRequestIp,
  getUserAgent,
  hashOptionalValue,
  hashToken,
  parseCookies,
  setCookie,
};
