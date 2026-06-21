const crypto = require('crypto');
const { query } = require('./db/client');
const { admin, initializeFirebase } = require('./firebaseAdmin');
const {
  getRequestIp,
  getUserAgent,
  hashOptionalValue,
} = require('./sessionSecurity');

const OTP_PURPOSE_SIGNUP = 'signup';
const OTP_LENGTH = Number(process.env.AUTH_OTP_LENGTH || 6);
const OTP_TTL_SECONDS = Number(process.env.AUTH_OTP_TTL_SECONDS || 10 * 60);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 5);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createHttpError(statusCode, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function normalizeEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw createHttpError(400, 'Enter a valid email address.');
  }

  return normalizedEmail;
}

function normalizeOtpCode(code) {
  const normalizedCode = String(code || '').replace(/\D/g, '').slice(0, OTP_LENGTH);

  if (normalizedCode.length !== OTP_LENGTH) {
    throw createHttpError(400, `Enter the ${OTP_LENGTH}-digit verification code.`);
  }

  return normalizedCode;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw createHttpError(400, 'Create a password with at least 6 characters.');
  }

  if (password.length > 128) {
    throw createHttpError(400, 'Password must be 128 characters or fewer.');
  }
}

function getServiceAccountPrivateKey() {
  if (process.env.FIREBASE_PRIVATE_KEY) {
    return process.env.FIREBASE_PRIVATE_KEY;
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return '';
  }

  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).private_key || '';
  } catch (_error) {
    return '';
  }
}

function getOtpSecret() {
  const secret =
    process.env.AUTH_OTP_SECRET ||
    process.env.OTP_SECRET ||
    getServiceAccountPrivateKey();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw createHttpError(500, 'OTP signing secret is not configured.');
  }

  return 'tryinterview-development-otp-secret';
}

function hashOtpCode(email, code, purpose = OTP_PURPOSE_SIGNUP) {
  return crypto
    .createHmac('sha256', getOtpSecret())
    .update(`${purpose}:${email}:${code}`)
    .digest('hex');
}

function generateOtpCode() {
  const upperBound = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, upperBound)).padStart(OTP_LENGTH, '0');
}

function getRequestFingerprint(req) {
  return {
    ipHash: hashOptionalValue(getRequestIp(req)),
    userAgentHash: hashOptionalValue(getUserAgent(req)),
  };
}

async function getFirebaseUserByEmail(email) {
  initializeFirebase();

  if (!admin.apps.length) {
    throw createHttpError(500, 'Firebase Admin is not initialized.');
  }

  try {
    return await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      return null;
    }

    throw error;
  }
}

function getEmailFromAddress() {
  return (
    process.env.AUTH_EMAIL_FROM ||
    process.env.EMAIL_FROM ||
    'TryInterview <no-reply@tryinterviews.site>'
  );
}

function buildOtpEmail({ email, code }) {
  const subject = 'Your TryInterview verification code';
  const text = [
    `Your TryInterview verification code is ${code}.`,
    '',
    `This code expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes.`,
    'If you did not request this code, you can safely ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; background:#0f131b; color:#e5e7eb; padding:28px;">
      <div style="max-width:480px; margin:0 auto; background:#171a22; border:1px solid rgba(148,163,184,.22); border-radius:18px; padding:24px;">
        <p style="margin:0 0 12px; color:#93c5fd; font-weight:700;">TryInterview</p>
        <h1 style="margin:0 0 12px; color:#f8fafc; font-size:24px;">Verify your email</h1>
        <p style="margin:0 0 18px; color:#a8b3c7;">Use this code to finish creating your TryInterview account.</p>
        <div style="letter-spacing:8px; font-size:32px; font-weight:800; color:#ffffff; background:#020617; border-radius:14px; padding:16px 18px; text-align:center;">${code}</div>
        <p style="margin:18px 0 0; color:#94a3b8; font-size:14px;">This code expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes.</p>
        <p style="margin:10px 0 0; color:#64748b; font-size:13px;">Sent to ${email}. If you did not request this, you can ignore this email.</p>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendWithResend({ to, subject, html, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getEmailFromAddress(),
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend email failed (${response.status}): ${body}`);
  }

  return { provider: 'resend' };
}

async function sendWithSendGrid({ to, subject, html, text }) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.SENDGRID_FROM_EMAIL || 'no-reply@tryinterviews.site', name: 'TryInterview' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SendGrid email failed (${response.status}): ${body}`);
  }

  return { provider: 'sendgrid' };
}

async function sendOtpEmail({ email, code }) {
  const message = buildOtpEmail({ email, code });

  if (process.env.RESEND_API_KEY) {
    return sendWithResend({ to: email, ...message });
  }

  if (process.env.SENDGRID_API_KEY) {
    return sendWithSendGrid({ to: email, ...message });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.warn(`TryInterview signup OTP for ${email}: ${code}`);
    return { provider: 'console' };
  }

  throw createHttpError(
    500,
    'Email delivery is not configured. Set RESEND_API_KEY or SENDGRID_API_KEY on the backend.'
  );
}

async function ensureCanIssueOtp(email) {
  const [existingActiveOtp] = await query(`
    SELECT
      id,
      GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM (sent_at + ($2::int * INTERVAL '1 second') - NOW())))
      )::int AS retry_after_seconds
    FROM email_signup_otps
    WHERE lower(email) = lower($1::text)
      AND purpose = $3::text
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY sent_at DESC
    LIMIT 1
  `, [email, OTP_RESEND_COOLDOWN_SECONDS, OTP_PURPOSE_SIGNUP]);

  if (existingActiveOtp?.retry_after_seconds > 0) {
    throw createHttpError(429, 'Please wait before requesting another code.', {
      retryAfterSeconds: existingActiveOtp.retry_after_seconds,
    });
  }
}

async function issueSignupOtp({ email, req }) {
  const normalizedEmail = normalizeEmail(email);
  const existingFirebaseUser = await getFirebaseUserByEmail(normalizedEmail);

  if (existingFirebaseUser) {
    throw createHttpError(409, 'This email already has an account. Sign in instead.');
  }

  await ensureCanIssueOtp(normalizedEmail);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(normalizedEmail, code);
  const { ipHash, userAgentHash } = getRequestFingerprint(req);

  await query(`
    UPDATE email_signup_otps
    SET revoked_at = NOW()
    WHERE lower(email) = lower($1::text)
      AND purpose = $2::text
      AND consumed_at IS NULL
      AND revoked_at IS NULL
  `, [normalizedEmail, OTP_PURPOSE_SIGNUP]);

  const [otpRow] = await query(`
    INSERT INTO email_signup_otps (
      email,
      purpose,
      code_hash,
      max_attempts,
      expires_at,
      request_ip_hash,
      user_agent_hash,
      metadata
    )
    VALUES (
      $1::text,
      $2::text,
      $3::text,
      $4::int,
      NOW() + ($5::int * INTERVAL '1 second'),
      $6::text,
      $7::text,
      $8::jsonb
    )
    RETURNING id, expires_at
  `, [
    normalizedEmail,
    OTP_PURPOSE_SIGNUP,
    codeHash,
    OTP_MAX_ATTEMPTS,
    OTP_TTL_SECONDS,
    ipHash,
    userAgentHash,
    JSON.stringify({ length: OTP_LENGTH }),
  ]);

  try {
    const delivery = await sendOtpEmail({ email: normalizedEmail, code });

    return {
      email: normalizedEmail,
      expiresAt: otpRow.expires_at,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      deliveryProvider: delivery.provider,
    };
  } catch (error) {
    await query(
      'UPDATE email_signup_otps SET revoked_at = NOW() WHERE id = $1::uuid',
      [otpRow.id]
    );
    throw error;
  }
}

async function consumeSignupOtp({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeOtpCode(code);
  const expectedHash = hashOtpCode(normalizedEmail, normalizedCode);

  const [otpRow] = await query(`
    SELECT id, code_hash, attempts, max_attempts
    FROM email_signup_otps
    WHERE lower(email) = lower($1::text)
      AND purpose = $2::text
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `, [normalizedEmail, OTP_PURPOSE_SIGNUP]);

  if (!otpRow) {
    throw createHttpError(400, 'Your verification code has expired. Request a new code.');
  }

  if (Number(otpRow.attempts) >= Number(otpRow.max_attempts)) {
    await query('UPDATE email_signup_otps SET revoked_at = NOW() WHERE id = $1::uuid', [otpRow.id]);
    throw createHttpError(429, 'Too many incorrect attempts. Request a new code.');
  }

  if (otpRow.code_hash !== expectedHash) {
    const attempts = Number(otpRow.attempts) + 1;
    const attemptsRemaining = Math.max(Number(otpRow.max_attempts) - attempts, 0);

    await query(`
      UPDATE email_signup_otps
      SET
        attempts = attempts + 1,
        revoked_at = CASE
          WHEN attempts + 1 >= max_attempts THEN NOW()
          ELSE revoked_at
        END
      WHERE id = $1::uuid
    `, [otpRow.id]);

    throw createHttpError(
      attemptsRemaining > 0 ? 400 : 429,
      attemptsRemaining > 0
        ? `Incorrect code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Request a new code.',
      { attemptsRemaining }
    );
  }

  await query(`
    UPDATE email_signup_otps
    SET consumed_at = NOW()
    WHERE id = $1::uuid
      AND consumed_at IS NULL
      AND revoked_at IS NULL
  `, [otpRow.id]);

  return { email: normalizedEmail };
}

async function createVerifiedEmailAccount({ email, password, code }) {
  const normalizedEmail = normalizeEmail(email);
  validatePassword(password);

  const existingFirebaseUser = await getFirebaseUserByEmail(normalizedEmail);
  if (existingFirebaseUser) {
    throw createHttpError(409, 'This email already has an account. Sign in instead.');
  }

  await consumeSignupOtp({ email: normalizedEmail, code });

  try {
    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      password,
      emailVerified: true,
    });
    const customToken = await admin.auth().createCustomToken(userRecord.uid, {
      email_signup_otp_verified: true,
    });

    return {
      customToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
      },
    };
  } catch (error) {
    if (error?.code === 'auth/email-already-exists') {
      throw createHttpError(409, 'This email already has an account. Sign in instead.');
    }

    throw error;
  }
}

module.exports = {
  createVerifiedEmailAccount,
  issueSignupOtp,
  normalizeEmail,
};
