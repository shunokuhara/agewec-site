-- Add optional public display name (nickname).
-- Blank nickname falls back to the real author name for public display.
ALTER TABLE submissions ADD COLUMN nickname TEXT;
