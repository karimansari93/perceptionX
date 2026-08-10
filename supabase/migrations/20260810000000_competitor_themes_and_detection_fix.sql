-- =============================================================================
-- Competitors tab rebuild — data layer.
--
-- 1. competitor_themes: per-response competitor ↔ attribute ↔ sentiment
--    triples, emitted by the theme-extraction pass (which until now analyzed
--    only the measured company). A separate table — NOT new rows in
--    ai_themes — because every existing sentiment rollup aggregates
--    ai_themes by response_id and would silently absorb competitor themes
--    into the measured company's numbers.
--
-- 2. Competitor-detection fix, applied everywhere a competitor list is
--    derived from prompt_responses.detected_competitors:
--      * self-exclusion of the measured company by word-boundary regex
--        (\mCOMPANY\M). Before this, Netflix ranked as its own top
--        competitor (100+ mentions per profile) and subsidiaries like
--        "Netflix Thailand" / "Ford Otosan" counted as competitors.
--      * NULL / empty / placeholder-token ('None', 'N/A', …) exclusion.
--      * the hardcoded job-board exclusion arrays are RETIRED. The same
--        names are seeded below as canonical_entities.is_active = false —
--        the sanctioned, admin-editable mechanism for "not an employer
--        competitor" — so the exclusion is data-driven and reversible.
--      * normalisation + alias mapping retained unchanged.
--    Touched: _refresh_cm_competitors() (the live per-company refresh of
--    the company_competitors_mv table) and company_competitors_by_location_mv.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. competitor_themes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_themes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id uuid NOT NULL REFERENCES public.prompt_responses(id) ON DELETE CASCADE,
    -- Denormalized from prompt_responses by the trigger below, so the tab can
    -- fetch a whole company's rows without a join and RLS can hash-probe it.
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    competitor_name text NOT NULL,
    attribute_id text NOT NULL,
    attribute_name text,
    sentiment text NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral')),
    sentiment_score numeric,
    context_snippet text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_themes_company_idx
    ON public.competitor_themes (company_id);
CREATE INDEX IF NOT EXISTS competitor_themes_response_idx
    ON public.competitor_themes (response_id);
CREATE INDEX IF NOT EXISTS competitor_themes_company_competitor_idx
    ON public.competitor_themes (company_id, competitor_name);

COMMENT ON TABLE public.competitor_themes IS
    'Competitor ↔ attribute ↔ sentiment triples per AI response, emitted by the theme-extraction pass alongside ai_themes (which stays measured-company-only). competitor_name is canonicalized at write time by trg_competitor_themes_prepare; rows naming the measured company, placeholder tokens, or inactive canonical entities are dropped before insert.';

-- -----------------------------------------------------------------------------
-- 2. Write-time canonicalization + exclusion for competitor_themes.
--    BEFORE INSERT; returning NULL drops the row, so noise never lands:
--      * NULL / empty / placeholder competitor names ('None', 'N/A', …)
--      * names mapping to an inactive canonical entity (admin-flagged
--        non-entities: job boards, regions, "No Competitors", …)
--      * the measured company itself, matched with word boundaries
--        (\mNetflix\M drops both "Netflix" and "Netflix Thailand" while
--        leaving "Netflixesque Co" alone), with a case-insensitive equality
--        fallback for names ending in non-word characters ("Disney+").
--    Mirrors prompt_responses' write-time canonicalization; alias edits are
--    NOT retroactive here (client re-canonicalizes on read via the alias map).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competitor_themes_prepare_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name          text;
    v_norm          text;
    v_canonical     text;
    v_is_active     boolean;
    v_company_id    uuid;
    v_company_name  text;
    v_company_regex text;
BEGIN
    v_name := TRIM(BOTH FROM COALESCE(NEW.competitor_name, ''));
    IF v_name = '' OR LOWER(v_name) IN ('none', 'n/a', 'na', 'null', 'undefined') THEN
        RETURN NULL;
    END IF;

    SELECT pr.company_id, c.name
      INTO v_company_id, v_company_name
      FROM public.prompt_responses pr
      LEFT JOIN public.companies c ON c.id = pr.company_id
     WHERE pr.id = NEW.response_id;

    -- A row we can't scope to a company would be invisible under RLS and
    -- unusable by the dashboard; drop it rather than storing dead weight.
    IF v_company_id IS NULL THEN
        RETURN NULL;
    END IF;
    NEW.company_id := v_company_id;

    -- Alias mapping (existing normalisation retained).
    v_norm := public.normalize_entity_name(v_name);
    IF v_norm IS NULL OR v_norm = '' THEN
        RETURN NULL;
    END IF;
    SELECT ce.canonical_name, ce.is_active
      INTO v_canonical, v_is_active
      FROM public.entity_aliases ea
      JOIN public.canonical_entities ce ON ce.id = ea.canonical_id
     WHERE ea.normalized_alias = v_norm;
    IF v_canonical IS NOT NULL THEN
        IF v_is_active IS FALSE THEN
            RETURN NULL;
        END IF;
        NEW.competitor_name := v_canonical;
    ELSE
        NEW.competitor_name := v_name;
    END IF;

    -- Self-exclusion of the measured company (word-boundary regex).
    IF v_company_name IS NOT NULL AND v_company_name <> '' THEN
        v_company_regex := '\m' || regexp_replace(v_company_name, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g') || '\M';
        IF NEW.competitor_name ~* v_company_regex
           OR LOWER(NEW.competitor_name) = LOWER(v_company_name) THEN
            RETURN NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competitor_themes_prepare ON public.competitor_themes;
CREATE TRIGGER trg_competitor_themes_prepare
    BEFORE INSERT ON public.competitor_themes
    FOR EACH ROW
    EXECUTE FUNCTION public.competitor_themes_prepare_row();

-- -----------------------------------------------------------------------------
-- 3. RLS — same shape as the hoisted ai_themes select policy (initplan
--    membership subquery, hash probe per row). Writes come from the service
--    role (edge functions), which bypasses RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE public.competitor_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS competitor_themes_select_policy ON public.competitor_themes;
CREATE POLICY competitor_themes_select_policy ON public.competitor_themes
FOR SELECT USING (
    (SELECT is_admin()) OR company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (SELECT auth.uid())
    )
);

GRANT SELECT ON public.competitor_themes TO authenticated;
GRANT ALL ON public.competitor_themes TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Retire the hardcoded job-board exclusion arrays into canonical_entities.
--    One UPDATE + one INSERT (set-based). The retroactive recanonicalization
--    triggers are DISABLED around the seed: with them enabled the seed fires
--    an unbounded UPDATE over every prompt_responses row whose text mentions
--    'linkedin'/'glassdoor'/…, which blew the statement timeout and wedged
--    the connection pool when this migration first ran as one transaction.
--    The stored canonical_competitors rewrite instead runs AFTERWARDS in
--    bounded batches (see recanonicalize_competitors_batch below); until it
--    completes, read-time consumers still drop the deactivated entities via
--    the alias map, so no stale name reaches the UI.
-- -----------------------------------------------------------------------------
ALTER TABLE public.canonical_entities DISABLE TRIGGER trg_canonical_entities_recanon;
ALTER TABLE public.entity_aliases     DISABLE TRIGGER trg_entity_aliases_recanon_ins;

WITH boards(canonical_name, aliases) AS (
    VALUES
        ('Glassdoor',      ARRAY['glassdoor']),
        ('Indeed',         ARRAY['indeed']),
        ('AmbitionBox',    ARRAY['ambitionbox']),
        ('Workday',        ARRAY['workday']),
        ('LinkedIn',       ARRAY['linkedin']),
        ('Monster',        ARRAY['monster']),
        ('CareerBuilder',  ARRAY['careerbuilder']),
        ('ZipRecruiter',   ARRAY['ziprecruiter']),
        ('Dice',           ARRAY['dice']),
        ('AngelList',      ARRAY['angellist', 'angelist']),
        ('Wellfound',      ARRAY['wellfound']),
        ('Built In',       ARRAY['built in', 'builtin']),
        ('Stack Overflow', ARRAY['stack overflow', 'stackoverflow']),
        ('GitHub',         ARRAY['github'])
),
upserted AS (
    INSERT INTO public.canonical_entities (canonical_name, normalized_name, entity_type, is_active, notes)
    SELECT b.canonical_name,
           public.normalize_entity_name(b.canonical_name),
           'platform',
           false,
           'Job board / platform, not an employer competitor. Migrated from the hardcoded exclusion list on 2026-08-10.'
    FROM boards b
    ON CONFLICT (normalized_name) DO UPDATE
        SET is_active = false,
            notes = COALESCE(canonical_entities.notes || ' | ', '')
                    || 'Deactivated 2026-08-10: job board / platform, not an employer competitor (was hardcoded exclusion).'
    RETURNING id, normalized_name
)
INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source)
SELECT u.id, a.alias, a.alias, 'migration_job_board_seed'
FROM upserted u
JOIN boards b ON public.normalize_entity_name(b.canonical_name) = u.normalized_name
CROSS JOIN LATERAL unnest(b.aliases) AS a(alias)
ON CONFLICT (normalized_alias) DO NOTHING;

ALTER TABLE public.canonical_entities ENABLE TRIGGER trg_canonical_entities_recanon;
ALTER TABLE public.entity_aliases     ENABLE TRIGGER trg_entity_aliases_recanon_ins;

-- Bounded batch worker for the deferred canonical_competitors rewrite. Each
-- call rewrites up to p_limit rows still carrying one of the given terms in
-- their STORED canonical string and returns the row count — call repeatedly
-- (ops script / SQL editor) until it returns 0. Never run the whole rewrite
-- in one statement: that is what took the project down on 2026-08-10.
CREATE OR REPLACE FUNCTION public.recanonicalize_competitors_batch(
    p_terms text[],
    p_limit integer DEFAULT 3000
)
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
    WHERE pr.id IN (
        SELECT pr2.id
        FROM public.prompt_responses pr2
        WHERE pr2.canonical_competitors IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM unnest(p_terms) AS t(term)
              WHERE t.term IS NOT NULL AND btrim(t.term) <> ''
                AND pr2.canonical_competitors ILIKE '%' || public.escape_like(btrim(t.term)) || '%'
          )
        LIMIT p_limit
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recanonicalize_competitors_batch(text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recanonicalize_competitors_batch(text[], integer) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Fixed competitor detection in the live per-company refresh function.
--    Body preserved from production (advisory lock, model exclusions,
--    p_company_id semantics) with these changes:
--      * hardcoded job-board array removed (handled by is_active = false)
--      * word-boundary self-exclusion of the measured company added
--      * the blanket 1–2-letter-name exclusion removed (it erased real
--        employers like EY and BP; single-character names stay excluded)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._refresh_cm_competitors(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_competitors_mv', 0));
  DELETE FROM public.company_competitors_mv WHERE (p_company_id IS NULL OR company_id = p_company_id);
  INSERT INTO public.company_competitors_mv
    (company_id, competitor_name, mention_count)
  WITH raw AS (
    SELECT pr.company_id,
           normalize_entity_name(TRIM(BOTH FROM unnest(string_to_array(pr.detected_competitors, ','::text)))) AS normalized_alias
    FROM prompt_responses pr
    WHERE pr.company_id IS NOT NULL AND pr.for_index IS NOT TRUE
      AND pr.detected_competitors IS NOT NULL AND pr.detected_competitors <> ''
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
  ), mapped AS (
    SELECT r.company_id, COALESCE(ce.canonical_name, initcap(r.normalized_alias)) AS competitor_name, ce.is_active
    FROM raw r
      LEFT JOIN entity_aliases ea ON ea.normalized_alias = r.normalized_alias
      LEFT JOIN canonical_entities ce ON ce.id = ea.canonical_id
    WHERE r.normalized_alias IS NOT NULL AND r.normalized_alias <> '' AND length(r.normalized_alias) > 1
      AND (r.normalized_alias <> ALL (ARRAY['none','n/a','na','null','undefined']))
      AND r.normalized_alias !~ '^[0-9]+$' AND r.normalized_alias ~ '[a-z0-9]'
  )
  SELECT m.company_id, m.competitor_name, count(*) AS mention_count
  FROM mapped m
  JOIN companies c ON c.id = m.company_id
  WHERE m.is_active IS NOT FALSE
    -- Self-exclusion: the measured company (and names containing it as a
    -- whole word, e.g. subsidiaries) never ranks as its own competitor.
    AND NOT (
      m.competitor_name ~* ('\m' || regexp_replace(c.name, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g') || '\M')
      OR lower(m.competitor_name) = lower(c.name)
    )
  GROUP BY m.company_id, m.competitor_name;
END $function$;

-- -----------------------------------------------------------------------------
-- 6. Same detection rules for the by-location rollup (still a true
--    materialized view, refreshed by the metrics tick). Recreated with
--    identical column list, index names, and grants.
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.company_competitors_by_location_mv;

CREATE MATERIALIZED VIEW public.company_competitors_by_location_mv AS
WITH raw AS (
  SELECT pr.company_id,
         COALESCE(NULLIF(btrim(cp.location_context), ''::text), ''::text) AS location_context,
         normalize_entity_name(btrim(unnest(string_to_array(pr.detected_competitors, ','::text)))) AS normalized_alias
  FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id IS NOT NULL
    AND pr.for_index IS NOT TRUE
    AND pr.detected_competitors IS NOT NULL
    AND pr.detected_competitors <> ''::text
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
), mapped AS (
  SELECT r.company_id,
         r.location_context,
         COALESCE(ce.canonical_name, initcap(r.normalized_alias)) AS competitor_name,
         ce.is_active
  FROM raw r
    LEFT JOIN entity_aliases ea ON ea.normalized_alias = r.normalized_alias
    LEFT JOIN canonical_entities ce ON ce.id = ea.canonical_id
  WHERE r.normalized_alias IS NOT NULL
    AND r.normalized_alias <> ''::text
    AND length(r.normalized_alias) > 1
    AND (r.normalized_alias <> ALL (ARRAY['none','n/a','na','null','undefined']))
    AND r.normalized_alias !~ '^[0-9]+$'::text
    AND r.normalized_alias ~ '[a-z0-9]'::text
)
SELECT m.company_id,
       m.location_context,
       m.competitor_name,
       count(*) AS mention_count
FROM mapped m
JOIN companies c ON c.id = m.company_id
WHERE m.is_active IS NOT FALSE
  AND NOT (
    m.competitor_name ~* ('\m' || regexp_replace(c.name, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g') || '\M')
    OR lower(m.competitor_name) = lower(c.name)
  )
GROUP BY m.company_id, m.location_context, m.competitor_name;

CREATE UNIQUE INDEX IF NOT EXISTS company_competitors_by_location_mv_uniq
  ON public.company_competitors_by_location_mv
  USING btree (company_id, location_context, competitor_name);
CREATE INDEX IF NOT EXISTS company_competitors_by_location_mv_lookup
  ON public.company_competitors_by_location_mv
  USING btree (company_id, location_context, mention_count DESC);

GRANT SELECT ON public.company_competitors_by_location_mv TO anon, authenticated;
GRANT SELECT ON public.company_competitors_by_location_mv TO service_role;

-- -----------------------------------------------------------------------------
-- 7. Post-migration ops (run OUTSIDE this transaction, each as its own
--    statement — deliberately not part of the migration):
--      a. SELECT public._refresh_cm_competitors(NULL);
--         (or wait for the metrics tick's rotation to rebuild it)
--      b. SELECT public.recanonicalize_competitors_batch(ARRAY[
--           'glassdoor','indeed','ambitionbox','workday','linkedin','monster',
--           'careerbuilder','ziprecruiter','dice','angellist','angelist',
--           'wellfound','built in','builtin','stack overflow','stackoverflow',
--           'github'], 3000);
--         repeatedly until it returns 0.
-- -----------------------------------------------------------------------------
