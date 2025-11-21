-- Create company_search_terms table for admin-managed search terms
-- This table stores search terms that admins can add to companies for enhanced search insights

CREATE TABLE IF NOT EXISTS company_search_terms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  search_term TEXT NOT NULL,
  monthly_volume INTEGER DEFAULT 0,
  is_manual BOOLEAN DEFAULT true, -- true for admin-added, false for auto-generated
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, search_term)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_company_search_terms_company_id 
ON company_search_terms(company_id);

CREATE INDEX IF NOT EXISTS idx_company_search_terms_search_term 
ON company_search_terms(search_term);

CREATE INDEX IF NOT EXISTS idx_company_search_terms_volume 
ON company_search_terms(monthly_volume DESC);

CREATE INDEX IF NOT EXISTS idx_company_search_terms_manual 
ON company_search_terms(is_manual);

-- Add trigger for updated_at
CREATE TRIGGER update_company_search_terms_updated_at
    BEFORE UPDATE ON company_search_terms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE company_search_terms ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view search terms for their companies
CREATE POLICY "Users can view search terms for their companies"
  ON company_search_terms FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT cm.company_id 
      FROM company_members cm 
      WHERE cm.user_id = auth.uid()
    )
  );

-- Only admins and owners can insert search terms
CREATE POLICY "Admins and owners can add search terms"
  ON company_search_terms FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT cm.company_id 
      FROM company_members cm 
      WHERE cm.user_id = auth.uid() 
      AND cm.role IN ('admin', 'owner')
    )
  );

-- Only admins and owners can update search terms
CREATE POLICY "Admins and owners can update search terms"
  ON company_search_terms FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT cm.company_id 
      FROM company_members cm 
      WHERE cm.user_id = auth.uid() 
      AND cm.role IN ('admin', 'owner')
    )
  );

-- Only admins and owners can delete search terms
CREATE POLICY "Admins and owners can delete search terms"
  ON company_search_terms FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT cm.company_id 
      FROM company_members cm 
      WHERE cm.user_id = auth.uid() 
      AND cm.role IN ('admin', 'owner')
    )
  );

-- Admin-specific policies for cross-company access
CREATE POLICY "Admins can view all search terms"
  ON company_search_terms FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_members cm 
      WHERE cm.user_id = auth.uid() 
      AND cm.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage all search terms"
  ON company_search_terms FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_members cm 
      WHERE cm.user_id = auth.uid() 
      AND cm.role = 'admin'
    )
  );



