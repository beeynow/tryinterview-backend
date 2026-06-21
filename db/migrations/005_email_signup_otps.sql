CREATE TABLE IF NOT EXISTS email_signup_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'signup',
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  request_ip_hash TEXT,
  user_agent_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_email_signup_otps_email_purpose_created
  ON email_signup_otps ((lower(email)), purpose, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_email_signup_otps_expires_at
  ON email_signup_otps (expires_at DESC);
-- statement-breakpoint
DROP TRIGGER IF EXISTS set_email_signup_otps_updated_at ON email_signup_otps;
-- statement-breakpoint
CREATE TRIGGER set_email_signup_otps_updated_at
  BEFORE UPDATE ON email_signup_otps
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
