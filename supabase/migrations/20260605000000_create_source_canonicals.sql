-- =============================================================================
-- Source canonicalization
--
-- Mirrors the competitor canonicalization scheme but for citation domains:
-- glassdoor.com / glassdoor.co.uk / glassdoor.ie all collapse to one
-- canonical brand (Glassdoor) in the Sources card.
--
-- Tables:
--   canonical_sources         — one row per real brand (Glassdoor, LinkedIn, ...)
--   source_aliases            — many rows per canonical; each maps a raw domain
--   source_alias_suggestions  — LLM review queue (parallel to entity_alias_suggestions)
--
-- The dashboard reads citations through a domain-rewriting view so the
-- canonicalization is applied at the data layer (no client-side mapping).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Domain-normalization helper
--    Strips protocol, lowercases, drops leading "www." and "m.", removes
--    trailing slashes and any path/query. Returns NULL for empty/garbage.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_source_domain(input_domain text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(
        TRIM(BOTH FROM
            REGEXP_REPLACE(
                -- drop any path, query, or fragment
                REGEXP_REPLACE(
                    -- drop common www/m subdomain prefixes
                    REGEXP_REPLACE(
                        -- drop protocol
                        REGEXP_REPLACE(LOWER(COALESCE(input_domain, '')), '^https?://', '', 'g'),
                        '^(www\.|m\.|mobile\.|amp\.)',
                        '',
                        ''
                    ),
                    '[/?#].*$',
                    '',
                    'g'
                ),
                '\.+$',
                '',
                'g'
            )
        ),
        ''
    );
$$;

COMMENT ON FUNCTION public.normalize_source_domain(text) IS
    'Lookup key for source domains. Lowercases, strips protocol, www/m subdomains, paths/queries.';


-- -----------------------------------------------------------------------------
-- 2. canonical_sources
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name text NOT NULL UNIQUE,
    domain_root text NOT NULL,              -- e.g. "glassdoor.com" — the primary identity domain
    normalized_domain_root text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    source_kind text,                        -- 'review' | 'social' | 'job_board' | 'news' | 'owned' | 'other'
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_sources_active_idx
    ON public.canonical_sources (is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS canonical_sources_kind_idx
    ON public.canonical_sources (source_kind);

CREATE OR REPLACE FUNCTION public.canonical_sources_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_sources_set_updated_at ON public.canonical_sources;
CREATE TRIGGER canonical_sources_set_updated_at
    BEFORE UPDATE ON public.canonical_sources
    FOR EACH ROW EXECUTE FUNCTION public.canonical_sources_touch_updated_at();


-- -----------------------------------------------------------------------------
-- 3. source_aliases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_id uuid NOT NULL REFERENCES public.canonical_sources(id) ON DELETE CASCADE,
    alias_domain text NOT NULL,
    normalized_alias_domain text NOT NULL,
    source text NOT NULL DEFAULT 'admin_manual',  -- 'admin_manual' | 'auto_rule' | 'llm_suggested'
    approved_by uuid,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS source_aliases_normalized_unique_idx
    ON public.source_aliases (normalized_alias_domain);

CREATE INDEX IF NOT EXISTS source_aliases_canonical_idx
    ON public.source_aliases (canonical_id);


-- -----------------------------------------------------------------------------
-- 4. source_alias_suggestions  (LLM review queue, for the eventual UI/job)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_alias_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_domain text NOT NULL,
    normalized_domain text NOT NULL UNIQUE,
    mention_count int NOT NULL DEFAULT 0,
    suggested_canonical_name text,
    suggested_source_kind text,
    suggested_is_non_entity boolean NOT NULL DEFAULT false,
    confidence numeric,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'merged_into_existing')),
    resolved_canonical_id uuid REFERENCES public.canonical_sources(id) ON DELETE SET NULL,
    llm_rationale text,
    llm_model text,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid
);

CREATE INDEX IF NOT EXISTS source_alias_suggestions_status_idx
    ON public.source_alias_suggestions (status, mention_count DESC);


-- -----------------------------------------------------------------------------
-- 5. RLS — admins write, authenticated read (same pattern as entity tables)
-- -----------------------------------------------------------------------------
ALTER TABLE public.canonical_sources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_aliases           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_alias_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_admin'
    ) THEN
        EXECUTE 'CREATE POLICY canonical_sources_admin ON public.canonical_sources
                 FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
        EXECUTE 'CREATE POLICY source_aliases_admin ON public.source_aliases
                 FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
        EXECUTE 'CREATE POLICY source_alias_suggestions_admin ON public.source_alias_suggestions
                 FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
    END IF;
END $$;

DROP POLICY IF EXISTS canonical_sources_read ON public.canonical_sources;
CREATE POLICY canonical_sources_read ON public.canonical_sources
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS source_aliases_read ON public.source_aliases;
CREATE POLICY source_aliases_read ON public.source_aliases
    FOR SELECT TO authenticated USING (true);


-- -----------------------------------------------------------------------------
-- 6. canonicalize_source_domain helper
--    Given a raw domain, returns the canonical brand name if there's an alias
--    that's mapped to an active canonical. Otherwise returns the normalized
--    domain unchanged (so unmapped sources stay visible).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_source_domain(input_domain text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH n AS (
        SELECT public.normalize_source_domain(input_domain) AS norm
    )
    SELECT
        COALESCE(cs.canonical_name, n.norm)
    FROM n
    LEFT JOIN public.source_aliases sa
           ON sa.normalized_alias_domain = n.norm
    LEFT JOIN public.canonical_sources cs
           ON cs.id = sa.canonical_id
          AND cs.is_active IS TRUE;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_source_domain(text)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canonicalize_source_domain(text)
    TO authenticated, service_role;
