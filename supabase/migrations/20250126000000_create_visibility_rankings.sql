-- Create visibility rankings table for monthly company rankings
-- Rankings are based on visibility prompts (Employee Experience and Candidate Experience themes)
-- Only includes responses from OpenAI GPT-4o-mini (cheapest GPT-4 model)

-- Create visibility_rankings table
CREATE TABLE IF NOT EXISTS visibility_rankings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ranking_period DATE NOT NULL, -- First day of the month (e.g., '2025-01-01')
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  industry TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  experience_category TEXT NOT NULL CHECK (experience_category IN ('Employee Experience', 'Candidate Experience')),
  theme TEXT NOT NULL, -- e.g., 'Mission & Purpose', 'Interview Experience', 'Company Culture', etc.
  visibility_score NUMERIC(5,2), -- NULL - calculated in frontend: (mentioned_count / total_responses) * 100
  detected_competitors TEXT, -- Comma-separated list of companies mentioned (e.g., "Vertex Pharmaceuticals, Takeda, Novartis")
  rank_position INTEGER NOT NULL, -- 1, 2, 3, etc.
  total_companies_in_ranking INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ranking_period, company_id, industry, country, experience_category, theme)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_rankings_period ON visibility_rankings(ranking_period DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_industry ON visibility_rankings(industry, ranking_period DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_company ON visibility_rankings(company_id, ranking_period DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_category_theme ON visibility_rankings(experience_category, theme, ranking_period DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_position ON visibility_rankings(industry, experience_category, theme, ranking_period DESC, rank_position);

-- Enable RLS
ALTER TABLE visibility_rankings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Allow admins to view all rankings
CREATE POLICY "Admins can view all visibility rankings" ON visibility_rankings
  FOR SELECT USING (is_admin());

-- Allow admins to insert rankings
CREATE POLICY "Admins can insert visibility rankings" ON visibility_rankings
  FOR INSERT WITH CHECK (is_admin());

-- Allow admins to update rankings
CREATE POLICY "Admins can update visibility rankings" ON visibility_rankings
  FOR UPDATE USING (is_admin());

-- Allow users to view rankings for their own companies
CREATE POLICY "Users can view rankings for their companies" ON visibility_rankings
  FOR SELECT USING (
    company_id IN (
      SELECT company_id
      FROM company_members
      WHERE user_id = auth.uid()
    )
  );

-- Add comments
COMMENT ON TABLE visibility_rankings IS 'Monthly visibility rankings for companies based on GPT-4o-mini responses to visibility prompts';
COMMENT ON COLUMN visibility_rankings.ranking_period IS 'First day of the month this ranking represents (e.g., 2025-01-01 for January 2025)';
COMMENT ON COLUMN visibility_rankings.visibility_score IS 'Visibility score (0-100). NULL - calculated in frontend from raw response data';
COMMENT ON COLUMN visibility_rankings.detected_competitors IS 'Comma-separated list of companies mentioned in responses (e.g., "Vertex Pharmaceuticals, Takeda, Novartis")';
COMMENT ON COLUMN visibility_rankings.rank_position IS 'Company rank position (1 = highest visibility, 2 = second highest, etc.)';
COMMENT ON COLUMN visibility_rankings.total_companies_in_ranking IS 'Total number of companies in this ranking group';

