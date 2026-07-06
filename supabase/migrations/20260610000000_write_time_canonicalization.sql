-- ============================================================================
-- Write-time canonicalization for prompt_responses
--
-- Why: prompt_responses_canonical computed canonicalize_citations() and
-- canonicalize_competitor_list() per row at READ time. Measured cost: a
-- 1000-row dashboard page takes ~564ms through the view vs ~5ms from the
-- base table — the alias-join functions are ~99% of the query time, paid on
-- every dashboard load, company switch, and MV refresh.
--
-- Fix: store the canonical values on prompt_responses, maintained by a
-- BEFORE INSERT/UPDATE trigger. The view returns the stored values and only
-- falls back to on-the-fly computation for rows not yet backfilled
-- (canonicalized_at IS NULL), so reads are correct mid-backfill.
--
-- Retroactivity: alias edits must still rewrite history (the whole point of
-- PR #36). Statement-level triggers on entity_aliases / canonical_entities /
-- source_aliases / canonical_sources recompute only the prompt_responses
-- rows whose raw text mentions the touched alias — a targeted scan per admin
-- action instead of a per-row tax on every read. (Scheduled full recomputes
-- are deliberately avoided: see 20260602000001_disable_mv_refresh_crons.sql
-- for the Disk IO budget context.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stored canonical columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.prompt_responses
    ADD COLUMN IF NOT EXISTS canonical_citations jsonb,
    ADD COLUMN IF NOT EXISTS canonical_competitors text,
    ADD COLUMN IF NOT EXISTS canonicalized_at timestamptz;

COMMENT ON COLUMN public.prompt_responses.canonical_citations IS
    'citations with canonical_domain/canonical_name merged in (see canonicalize_citations). Maintained by trg_prompt_responses_canonicalize; NULL-able, valid only when canonicalized_at IS NOT NULL.';
COMMENT ON COLUMN public.prompt_responses.canonical_competitors IS
    'detected_competitors with entity aliases applied (see canonicalize_competitor_list). Valid only when canonicalized_at IS NOT NULL.';
COMMENT ON COLUMN public.prompt_responses.canonicalized_at IS
    'When the stored canonical columns were last computed. NULL = not yet backfilled; the view computes on the fly for such rows.';

-- Lets the backfill find remaining work without scanning the table.
CREATE INDEX IF NOT EXISTS idx_prompt_responses_needs_canonicalization
    ON public.prompt_responses (id)
    WHERE canonicalized_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Keep stored values fresh on write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prompt_responses_canonicalize_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
    NEW.canonical_citations   := public.canonicalize_citations(NEW.citations);
    NEW.canonical_competitors := public.canonicalize_competitor_list(NEW.detected_competitors);
    NEW.canonicalized_at      := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prompt_responses_canonicalize ON public.prompt_responses;
CREATE TRIGGER trg_prompt_responses_canonicalize
    BEFORE INSERT OR UPDATE OF citations, detected_competitors
    ON public.prompt_responses
    FOR EACH ROW
    EXECUTE FUNCTION public.prompt_responses_canonicalize_row();

-- ---------------------------------------------------------------------------
-- 3. View: read stored values, fall back for not-yet-backfilled rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.prompt_responses_canonical AS
SELECT
    pr.id,
    pr.confirmed_prompt_id,
    pr.ai_model,
    pr.response_text,
    CASE
        WHEN pr.canonicalized_at IS NOT NULL THEN pr.canonical_citations
        ELSE public.canonicalize_citations(pr.citations)
    END AS citations,
    pr.company_mentioned,
    pr.created_at,
    pr.updated_at,
    pr.tested_at,
    pr.company_id,
    pr.created_by,
    pr.for_index,
    pr.index_period,
    pr.response_month,
    pr.collection_cycle,
    CASE
        WHEN pr.canonicalized_at IS NOT NULL THEN pr.canonical_competitors
        ELSE public.canonicalize_competitor_list(pr.detected_competitors)
    END AS detected_competitors
FROM public.prompt_responses pr;

COMMENT ON VIEW public.prompt_responses_canonical IS
    'prompt_responses with citations + detected_competitors canonicalized. Values are precomputed at write time (canonical_* columns); the per-row function fallback only runs for rows where canonicalized_at IS NULL.';

-- ---------------------------------------------------------------------------
-- 4. Batched backfill (also the safety net if rows ever go stale)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_prompt_responses_backfill(
    p_batch_size integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH batch AS (
        SELECT id
        FROM public.prompt_responses
        WHERE canonicalized_at IS NULL
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.prompt_responses pr
    SET canonical_citations   = public.canonicalize_citations(pr.citations),
        canonical_competitors = public.canonicalize_competitor_list(pr.detected_competitors),
        canonicalized_at      = now()
    FROM batch
    WHERE pr.id = batch.id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.canonicalize_prompt_responses_backfill(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonicalize_prompt_responses_backfill(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_prompt_responses_backfill(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Retroactive recompute when aliases change
-- ---------------------------------------------------------------------------

-- Escape LIKE wildcards in user-entered alias text before substring matching.
CREATE OR REPLACE FUNCTION public.escape_like(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Recompute canonical_competitors for rows mentioning any of the given terms.
-- Substring match over-approximates (normalization differences) — harmless,
-- since recomputation is idempotent and only touches matched rows.
CREATE OR REPLACE FUNCTION public.recanonicalize_competitors_for_terms(p_terms text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_terms IS NULL OR array_length(p_terms, 1) IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.prompt_responses pr
    SET canonical_competitors = public.canonicalize_competitor_list(pr.detected_competitors),
        canonicalized_at      = now()
    WHERE pr.detected_competitors IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM unnest(p_terms) AS t(term)
          WHERE t.term IS NOT NULL
            AND btrim(t.term) <> ''
            AND pr.detected_competitors ILIKE '%' || public.escape_like(btrim(t.term)) || '%'
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Recompute canonical_citations for rows whose citations mention any of the
-- given domains.
CREATE OR REPLACE FUNCTION public.recanonicalize_citations_for_domains(p_domains text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_domains IS NULL OR array_length(p_domains, 1) IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.prompt_responses pr
    SET canonical_citations = public.canonicalize_citations(pr.citations),
        canonicalized_at    = now()
    WHERE pr.citations IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM unnest(p_domains) AS d(dom)
          WHERE d.dom IS NOT NULL
            AND btrim(d.dom) <> ''
            AND pr.citations::text ILIKE '%' || public.escape_like(btrim(d.dom)) || '%'
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recanonicalize_competitors_for_terms(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recanonicalize_citations_for_domains(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recanonicalize_competitors_for_terms(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.recanonicalize_citations_for_domains(text[]) TO service_role;

-- --- entity_aliases: alias added / changed / removed -----------------------
CREATE OR REPLACE FUNCTION public.entity_aliases_recanonicalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_terms text[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT alias) INTO v_terms FROM new_table;
    ELSIF TG_OP = 'UPDATE' THEN
        SELECT array_agg(DISTINCT alias) INTO v_terms
        FROM (SELECT alias FROM new_table UNION SELECT alias FROM old_table) u;
    ELSE
        SELECT array_agg(DISTINCT alias) INTO v_terms FROM old_table;
    END IF;

    PERFORM public.recanonicalize_competitors_for_terms(v_terms);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_aliases_recanon_ins ON public.entity_aliases;
DROP TRIGGER IF EXISTS trg_entity_aliases_recanon_upd ON public.entity_aliases;
DROP TRIGGER IF EXISTS trg_entity_aliases_recanon_del ON public.entity_aliases;

CREATE TRIGGER trg_entity_aliases_recanon_ins
    AFTER INSERT ON public.entity_aliases
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.entity_aliases_recanonicalize();
CREATE TRIGGER trg_entity_aliases_recanon_upd
    AFTER UPDATE ON public.entity_aliases
    REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.entity_aliases_recanonicalize();
CREATE TRIGGER trg_entity_aliases_recanon_del
    AFTER DELETE ON public.entity_aliases
    REFERENCING OLD TABLE AS old_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.entity_aliases_recanonicalize();

-- --- canonical_entities: rename / (de)activation ---------------------------
CREATE OR REPLACE FUNCTION public.canonical_entities_recanonicalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_terms text[];
BEGIN
    SELECT array_agg(DISTINCT ea.alias) INTO v_terms
    FROM new_table n
    JOIN old_table o ON o.id = n.id
    JOIN public.entity_aliases ea ON ea.canonical_id = n.id
    WHERE n.canonical_name IS DISTINCT FROM o.canonical_name
       OR n.is_active IS DISTINCT FROM o.is_active;

    PERFORM public.recanonicalize_competitors_for_terms(v_terms);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_entities_recanon ON public.canonical_entities;
CREATE TRIGGER trg_canonical_entities_recanon
    AFTER UPDATE ON public.canonical_entities
    REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_entities_recanonicalize();

-- --- source_aliases: alias domain added / changed / removed ----------------
CREATE OR REPLACE FUNCTION public.source_aliases_recanonicalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_domains text[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT alias_domain) INTO v_domains FROM new_table;
    ELSIF TG_OP = 'UPDATE' THEN
        SELECT array_agg(DISTINCT alias_domain) INTO v_domains
        FROM (SELECT alias_domain FROM new_table UNION SELECT alias_domain FROM old_table) u;
    ELSE
        SELECT array_agg(DISTINCT alias_domain) INTO v_domains FROM old_table;
    END IF;

    PERFORM public.recanonicalize_citations_for_domains(v_domains);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_source_aliases_recanon_ins ON public.source_aliases;
DROP TRIGGER IF EXISTS trg_source_aliases_recanon_upd ON public.source_aliases;
DROP TRIGGER IF EXISTS trg_source_aliases_recanon_del ON public.source_aliases;

CREATE TRIGGER trg_source_aliases_recanon_ins
    AFTER INSERT ON public.source_aliases
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.source_aliases_recanonicalize();
CREATE TRIGGER trg_source_aliases_recanon_upd
    AFTER UPDATE ON public.source_aliases
    REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.source_aliases_recanonicalize();
CREATE TRIGGER trg_source_aliases_recanon_del
    AFTER DELETE ON public.source_aliases
    REFERENCING OLD TABLE AS old_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.source_aliases_recanonicalize();

-- --- canonical_sources: rename / root-domain change / (de)activation -------
CREATE OR REPLACE FUNCTION public.canonical_sources_recanonicalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_domains text[];
BEGIN
    SELECT array_agg(DISTINCT sa.alias_domain) INTO v_domains
    FROM new_table n
    JOIN old_table o ON o.id = n.id
    JOIN public.source_aliases sa ON sa.canonical_id = n.id
    WHERE n.canonical_name IS DISTINCT FROM o.canonical_name
       OR n.domain_root IS DISTINCT FROM o.domain_root
       OR n.is_active IS DISTINCT FROM o.is_active;

    PERFORM public.recanonicalize_citations_for_domains(v_domains);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_sources_recanon ON public.canonical_sources;
CREATE TRIGGER trg_canonical_sources_recanon
    AFTER UPDATE ON public.canonical_sources
    REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_sources_recanonicalize();
