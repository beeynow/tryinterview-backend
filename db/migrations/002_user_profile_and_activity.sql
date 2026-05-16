ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS country TEXT;
-- statement-breakpoint
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT;
-- statement-breakpoint
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS target_role TEXT;
-- statement-breakpoint
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_app_users_onboarded
  ON app_users (onboarded, onboarding_completed_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS user_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_source TEXT,
  entity_type TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_id
  ON user_activity_events (user_id, occurred_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_activity_events_event_type
  ON user_activity_events (event_type, occurred_at DESC);
