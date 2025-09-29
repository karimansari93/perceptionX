-- Create table for caching URL recency analysis to avoid duplicate Firecrawl calls
CREATE TABLE IF NOT EXISTS url_recency_cache (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  publication_date DATE,
  recency_score INTEGER,
  extraction_method TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_recency_score CHECK (recency_score IS NULL OR (recency_score >= 0 AND recency_score <= 100)),
  CONSTRAINT valid_extraction_method CHECK (extraction_method IN ('url-pattern', 'firecrawl-json', 'firecrawl-html', 'not-found', 'rate-limit-hit', 'timeout'))
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_url_recency_cache_url ON url_recency_cache(url);
CREATE INDEX IF NOT EXISTS idx_url_recency_cache_domain ON url_recency_cache(domain);
CREATE INDEX IF NOT EXISTS idx_url_recency_cache_last_checked ON url_recency_cache(last_checked_at);

-- Create function to automatically update last_checked_at on updates
CREATE OR REPLACE FUNCTION update_last_checked_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_checked_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to call the function
CREATE TRIGGER update_url_recency_cache_last_checked_at
    BEFORE UPDATE ON url_recency_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_last_checked_at_column();

