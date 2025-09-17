-- Create search insights tables for storing search analysis results
-- This migration creates tables to store search insights data from the Search feature

-- Create search_insights_sessions table to track each search session
CREATE TABLE IF NOT EXISTS search_insights_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  initial_search_term TEXT NOT NULL,
  total_results INTEGER DEFAULT 0,
  total_related_terms INTEGER DEFAULT 0,
  total_volume INTEGER DEFAULT 0,
  keywords_everywhere_available BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create search_insights_results table to store individual search results
CREATE TABLE IF NOT EXISTS search_insights_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES search_insights_sessions(id) ON DELETE CASCADE,
  search_term TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  snippet TEXT,
  position INTEGER NOT NULL,
  domain TEXT NOT NULL,
  monthly_search_volume INTEGER DEFAULT 0,
  media_type TEXT DEFAULT 'organic' CHECK (media_type IN ('owned', 'influenced', 'organic', 'competitive', 'irrelevant')),
  date_found TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create search_insights_terms table to store search terms with their volumes
CREATE TABLE IF NOT EXISTS search_insights_terms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES search_insights_sessions(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  monthly_volume INTEGER DEFAULT 0,
  results_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_search_insights_sessions_user_id 
ON search_insights_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_search_insights_sessions_created_at 
ON search_insights_sessions(created_at);

CREATE INDEX IF NOT EXISTS idx_search_insights_results_session_id 
ON search_insights_results(session_id);

CREATE INDEX IF NOT EXISTS idx_search_insights_results_search_term 
ON search_insights_results(search_term);

CREATE INDEX IF NOT EXISTS idx_search_insights_results_domain 
ON search_insights_results(domain);

CREATE INDEX IF NOT EXISTS idx_search_insights_terms_session_id 
ON search_insights_terms(session_id);

CREATE INDEX IF NOT EXISTS idx_search_insights_terms_volume 
ON search_insights_terms(monthly_volume DESC);

-- Add trigger to update updated_at for sessions
CREATE OR REPLACE FUNCTION update_search_insights_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_search_insights_sessions_updated_at 
BEFORE UPDATE ON search_insights_sessions 
FOR EACH ROW 
EXECUTE FUNCTION update_search_insights_sessions_updated_at();

-- Add RLS (Row Level Security) policies
ALTER TABLE search_insights_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_insights_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_insights_terms ENABLE ROW LEVEL SECURITY;

-- Create policies for search_insights_sessions
CREATE POLICY "Users can view their own search sessions" ON search_insights_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own search sessions" ON search_insights_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own search sessions" ON search_insights_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own search sessions" ON search_insights_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Create policies for search_insights_results
CREATE POLICY "Users can view results from their sessions" ON search_insights_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert results to their sessions" ON search_insights_results
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update results from their sessions" ON search_insights_results
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete results from their sessions" ON search_insights_results
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

-- Create policies for search_insights_terms
CREATE POLICY "Users can view terms from their sessions" ON search_insights_terms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert terms to their sessions" ON search_insights_terms
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update terms from their sessions" ON search_insights_terms
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete terms from their sessions" ON search_insights_terms
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM search_insights_sessions 
      WHERE id = session_id AND user_id = auth.uid()
    )
  );
