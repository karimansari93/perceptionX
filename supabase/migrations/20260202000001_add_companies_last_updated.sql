-- Add last_updated to companies for "when did we last run data collection"
-- collect-company-responses already updates this; the column was missing.
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

COMMENT ON COLUMN companies.last_updated IS 'Set when data collection (prompt responses) last completed for this company';
