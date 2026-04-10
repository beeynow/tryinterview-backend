CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT,
  photo_url TEXT,
  provider TEXT,
  onboarded BOOLEAN NOT NULL DEFAULT FALSE,
  job_title TEXT,
  experience TEXT,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  goals TEXT,
  interview_type TEXT,
  availability JSONB NOT NULL DEFAULT '{}'::jsonb,
  notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_id TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users ((lower(email)));
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_app_users_last_login_at ON app_users (last_login_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  locale TEXT,
  timezone TEXT,
  marketing_emails BOOLEAN NOT NULL DEFAULT FALSE,
  product_updates BOOLEAN NOT NULL DEFAULT TRUE,
  interview_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  privacy JSONB NOT NULL DEFAULT '{}'::jsonb,
  cookie_consent JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT,
  firebase_session_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, external_event_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT,
  plan_name TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER,
  currency TEXT,
  billing_interval TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions (user_id, status);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (stripe_customer_id);
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_active_per_user
  ON subscriptions (user_id)
  WHERE status = 'active';
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS question_bank_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES question_bank_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS question_bank_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES question_bank_categories(id) ON DELETE SET NULL,
  role TEXT,
  company TEXT,
  interview_type TEXT,
  difficulty TEXT,
  question_text TEXT NOT NULL,
  sample_answer TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_question_bank_items_category ON question_bank_items (category_id);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_question_bank_items_type_difficulty
  ON question_bank_items (interview_type, difficulty);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS interview_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  role TEXT,
  company TEXT,
  interview_type TEXT NOT NULL,
  difficulty TEXT,
  focus_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_interview_blueprints_user_id ON interview_blueprints (user_id);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  blueprint_id UUID REFERENCES interview_blueprints(id) ON DELETE SET NULL,
  title TEXT,
  role TEXT,
  company TEXT,
  interview_type TEXT NOT NULL,
  difficulty TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  overall_score NUMERIC(5,2),
  summary TEXT,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  media JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_interviews_user_id_created_at ON interviews (user_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews (status);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS interview_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  question_bank_item_id UUID REFERENCES question_bank_items(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  category TEXT,
  difficulty TEXT,
  sequence_number INTEGER NOT NULL,
  expected_focus JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_text TEXT,
  response_duration_seconds INTEGER,
  evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (interview_id, sequence_number)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS interview_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
  overall_score NUMERIC(5,2),
  communication_score NUMERIC(5,2),
  technical_score NUMERIC(5,2),
  confidence_score NUMERIC(5,2),
  structure_score NUMERIC(5,2),
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  detailed_feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS interview_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_interview_events_user_id ON interview_events (user_id, occurred_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS resume_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS resume_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  resume_upload_id UUID REFERENCES resume_uploads(id) ON DELETE SET NULL,
  overall_score NUMERIC(5,2),
  ats_score NUMERIC(5,2),
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  analyzer_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_resume_analyses_user_id ON resume_analyses (user_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS achievement_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  points INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievement_definitions(id) ON DELETE CASCADE,
  progress NUMERIC(10,2) NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements (user_id, unlocked_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  certificate_code TEXT NOT NULL UNIQUE,
  certificate_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  verification_url TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_certificates_user_id ON certificates (user_id, issued_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS user_progress (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  interviews_completed INTEGER NOT NULL DEFAULT 0,
  average_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_practice_seconds INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  resume_analyses_completed INTEGER NOT NULL DEFAULT 0,
  certificates_earned INTEGER NOT NULL DEFAULT 0,
  achievements_unlocked INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE OR REPLACE FUNCTION refresh_user_progress_snapshot(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO user_progress (
    user_id,
    interviews_completed,
    average_score,
    total_practice_seconds,
    resume_analyses_completed,
    certificates_earned,
    achievements_unlocked,
    last_activity_at,
    snapshot
  )
  SELECT
    u.id,
    COALESCE(interview_metrics.interviews_completed, 0),
    COALESCE(interview_metrics.average_score, 0),
    COALESCE(interview_metrics.total_practice_seconds, 0),
    COALESCE(resume_metrics.resume_analyses_completed, 0),
    COALESCE(certificate_metrics.certificates_earned, 0),
    COALESCE(achievement_metrics.achievements_unlocked, 0),
    GREATEST(
      COALESCE(interview_metrics.last_activity_at, TIMESTAMPTZ 'epoch'),
      COALESCE(resume_metrics.last_activity_at, TIMESTAMPTZ 'epoch'),
      COALESCE(certificate_metrics.last_activity_at, TIMESTAMPTZ 'epoch'),
      COALESCE(achievement_metrics.last_activity_at, TIMESTAMPTZ 'epoch')
    ),
    jsonb_build_object(
      'interviewsCompleted', COALESCE(interview_metrics.interviews_completed, 0),
      'averageScore', COALESCE(interview_metrics.average_score, 0),
      'resumeAnalysesCompleted', COALESCE(resume_metrics.resume_analyses_completed, 0),
      'certificatesEarned', COALESCE(certificate_metrics.certificates_earned, 0),
      'achievementsUnlocked', COALESCE(achievement_metrics.achievements_unlocked, 0)
    )
  FROM app_users u
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed')::INTEGER AS interviews_completed,
      AVG(overall_score) FILTER (WHERE status = 'completed')::NUMERIC(5,2) AS average_score,
      COALESCE(SUM(duration_seconds) FILTER (WHERE status = 'completed'), 0)::INTEGER AS total_practice_seconds,
      MAX(COALESCE(completed_at, updated_at, created_at)) AS last_activity_at
    FROM interviews
    WHERE user_id = u.id
  ) interview_metrics ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::INTEGER AS resume_analyses_completed,
      MAX(created_at) AS last_activity_at
    FROM resume_analyses
    WHERE user_id = u.id
  ) resume_metrics ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE revoked_at IS NULL)::INTEGER AS certificates_earned,
      MAX(issued_at) AS last_activity_at
    FROM certificates
    WHERE user_id = u.id
  ) certificate_metrics ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE unlocked_at IS NOT NULL)::INTEGER AS achievements_unlocked,
      MAX(unlocked_at) AS last_activity_at
    FROM user_achievements
    WHERE user_id = u.id
  ) achievement_metrics ON TRUE
  WHERE u.id = p_user_id
  ON CONFLICT (user_id) DO UPDATE SET
    interviews_completed = EXCLUDED.interviews_completed,
    average_score = EXCLUDED.average_score,
    total_practice_seconds = EXCLUDED.total_practice_seconds,
    resume_analyses_completed = EXCLUDED.resume_analyses_completed,
    certificates_earned = EXCLUDED.certificates_earned,
    achievements_unlocked = EXCLUDED.achievements_unlocked,
    last_activity_at = EXCLUDED.last_activity_at,
    snapshot = EXCLUDED.snapshot,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
INSERT INTO achievement_definitions (slug, name, description, category, criteria, points)
VALUES
  ('first-interview', 'First Interview', 'Complete your first mock interview.', 'interview', '{"interviewsCompleted":1}'::jsonb, 50),
  ('streak-seven', '7 Day Streak', 'Practice consistently for seven days.', 'progress', '{"currentStreak":7}'::jsonb, 100),
  ('score-ninety', 'Elite Score', 'Score 90 or higher in a completed interview.', 'interview', '{"averageScore":90}'::jsonb, 150)
ON CONFLICT (slug) DO NOTHING;
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users;
-- statement-breakpoint
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
-- statement-breakpoint
CREATE TRIGGER trg_user_settings_updated_at
BEFORE UPDATE ON user_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_auth_sessions_updated_at ON auth_sessions;
-- statement-breakpoint
CREATE TRIGGER trg_auth_sessions_updated_at
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
-- statement-breakpoint
CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_question_bank_categories_updated_at ON question_bank_categories;
-- statement-breakpoint
CREATE TRIGGER trg_question_bank_categories_updated_at
BEFORE UPDATE ON question_bank_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_question_bank_items_updated_at ON question_bank_items;
-- statement-breakpoint
CREATE TRIGGER trg_question_bank_items_updated_at
BEFORE UPDATE ON question_bank_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_interview_blueprints_updated_at ON interview_blueprints;
-- statement-breakpoint
CREATE TRIGGER trg_interview_blueprints_updated_at
BEFORE UPDATE ON interview_blueprints
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_interviews_updated_at ON interviews;
-- statement-breakpoint
CREATE TRIGGER trg_interviews_updated_at
BEFORE UPDATE ON interviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_interview_questions_updated_at ON interview_questions;
-- statement-breakpoint
CREATE TRIGGER trg_interview_questions_updated_at
BEFORE UPDATE ON interview_questions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_interview_feedback_updated_at ON interview_feedback;
-- statement-breakpoint
CREATE TRIGGER trg_interview_feedback_updated_at
BEFORE UPDATE ON interview_feedback
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_achievement_definitions_updated_at ON achievement_definitions;
-- statement-breakpoint
CREATE TRIGGER trg_achievement_definitions_updated_at
BEFORE UPDATE ON achievement_definitions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_user_achievements_updated_at ON user_achievements;
-- statement-breakpoint
CREATE TRIGGER trg_user_achievements_updated_at
BEFORE UPDATE ON user_achievements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_certificates_updated_at ON certificates;
-- statement-breakpoint
CREATE TRIGGER trg_certificates_updated_at
BEFORE UPDATE ON certificates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- statement-breakpoint
DROP TRIGGER IF EXISTS trg_user_progress_updated_at ON user_progress;
-- statement-breakpoint
CREATE TRIGGER trg_user_progress_updated_at
BEFORE UPDATE ON user_progress
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
