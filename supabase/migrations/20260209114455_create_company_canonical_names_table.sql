-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260209114455; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Create table to map company name variations to canonical names
CREATE TABLE public.company_canonical_names (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The raw company name as it appears in AI responses (lowercase, trimmed)
    variant_name text NOT NULL,
    
    -- The canonical/parent company name for grouping
    canonical_name text NOT NULL,
    
    -- Official website domain for favicon fetching (e.g., "3m.com")
    website_domain text,
    
    -- Optional: link to companies table if this is a tracked client
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    
    -- Whether this mapping was AI-generated or manually verified
    is_verified boolean DEFAULT false,
    
    -- Source of the mapping
    source text DEFAULT 'ai_generated' CHECK (source IN ('ai_generated', 'manual', 'imported')),
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Ensure unique variant names
    CONSTRAINT unique_variant_name UNIQUE (variant_name)
);

-- Create indexes for fast lookups
CREATE INDEX idx_canonical_names_variant ON public.company_canonical_names(variant_name);
CREATE INDEX idx_canonical_names_canonical ON public.company_canonical_names(canonical_name);
CREATE INDEX idx_canonical_names_company_id ON public.company_canonical_names(company_id);

-- Enable RLS
ALTER TABLE public.company_canonical_names ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (for rankings display)
CREATE POLICY "Authenticated users can read canonical names"
ON public.company_canonical_names
FOR SELECT
TO authenticated
USING (true);

-- Only admins can modify
CREATE POLICY "Admins can manage canonical names"
ON public.company_canonical_names
FOR ALL
TO authenticated
USING ((SELECT is_admin()))
WITH CHECK ((SELECT is_admin()));

-- Add updated_at trigger
CREATE TRIGGER update_company_canonical_names_updated_at
    BEFORE UPDATE ON public.company_canonical_names
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE public.company_canonical_names IS 'Maps company name variations (from AI responses) to canonical names for grouping and favicon resolution';

