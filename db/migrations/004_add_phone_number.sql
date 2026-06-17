ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS phone_number TEXT;
