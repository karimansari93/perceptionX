-- Career Site tab: which parts of a client's own career site are doing the
-- work in AI answers, and which topics third parties answer instead.
--
-- Three reads back the tab, all cube-fed so a tab load is an index lookup:
--
--   * get_career_site_overview — the detected career-site property (the set
--     of owned career domains) plus its cited pages, reusing the existing
--     company_page_stats_mv page cube filtered to those domains;
--   * get_career_site_gaps     — topic ownership: per attribute, the share of
--     answers citing the career site vs. the share citing an employer-review
--     or job-board benchmark domain. This is the tab's headline signal;
--   * get_career_site_passages — the literal passages Google AI Overviews /
--     AI Mode quoted from a page, recovered from the `#:~:text=` scroll-to-
--     text fragments those two platforms attach to citations.
--
-- Semantics follow company_domain_stats_mv exactly (canonical citations,
-- domains lowercased with a leading www. stripped, models claude/gemini/
-- deepseek excluded, "overall candidate experience" excluded, for_index
-- included) so a page's share is directly comparable with its domain's.
--
-- Sentiment is deliberately NOT a page measure here. Measured across a
-- client's own career-site pages it does not discriminate — every page lands
-- in a narrow band because an answer citing the career site almost always
-- mentions the brand — so the tab ranks on citation share and topic
-- ownership instead.

-- ---------------------------------------------------------------------------
-- 1. Page identity
-- ---------------------------------------------------------------------------

-- Career-site URLs carry locale in the query string, so one page arrives as
-- /main, /main/?lang=pt-BR and /main?previousLocale=en-US. Collapse those on
-- top of the shared citation normalizer (fragment + tracking params).
CREATE OR REPLACE FUNCTION public.career_site_canonical_page(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            public.mcp_normalize_cited_url(p_url),
            '([?&])(lang|locale|previouslocale|language|hl|country)=[^&]*', '\1', 'gi'),
          '([?&])&+', '\1', 'g'),
        '[?&]+$', ''),
      '(.)/$', '\1'),
    '')
$$;

-- Individual job requisitions expire; durable content pages (benefits,
-- culture, locations, early careers) are what the tab's actions target.
CREATE OR REPLACE FUNCTION public.career_site_page_kind(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_url ~* '/(jobs?|requisition|vacancy|vacature|stellenangebote)/[0-9a-f-]{4,}' THEN 'job_posting'
    WHEN p_url ~* '/job/[^/]+/[0-9]' THEN 'job_posting'
    WHEN p_url ~* 'myworkdayjobs\.com/.+/job/' THEN 'job_posting'
    ELSE 'content'
  END
$$;

-- ---------------------------------------------------------------------------
-- 2. Benchmark domains — the employer-review and job-board sites a career
--    site competes with for the answer. Seeded from src/utils/sourceConfig.ts
--    and extendable without a code deploy.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.career_site_benchmark_domains (
  domain text PRIMARY KEY,
  label  text NOT NULL,
  kind   text NOT NULL DEFAULT 'review'
);

INSERT INTO public.career_site_benchmark_domains (domain, label, kind) VALUES
  ('glassdoor.com','Glassdoor','review'),
  ('indeed.com','Indeed','job-board'),
  ('kununu.com','Kununu','review'),
  ('comparably.com','Comparably','review'),
  ('ambitionbox.com','AmbitionBox','review'),
  ('teamblind.com','Blind','community'),
  ('reddit.com','Reddit','community'),
  ('quora.com','Quora','community'),
  ('linkedin.com','LinkedIn','professional-network'),
  ('levels.fyi','levels.fyi','salary'),
  ('payscale.com','PayScale','salary'),
  ('salary.com','Salary.com','salary'),
  ('zippia.com','Zippia','review'),
  ('builtin.com','Built In','job-board'),
  ('themuse.com','The Muse','employer-branding'),
  ('greatplacetowork.com','Great Place To Work','review'),
  ('vault.com','Vault','review'),
  ('fairygodboss.com','Fairygodboss','review'),
  ('careerbliss.com','CareerBliss','review'),
  ('inhersight.com','InHerSight','review'),
  ('fishbowlapp.com','Fishbowl','community'),
  ('seek.com.au','SEEK','job-board'),
  ('monster.com','Monster','job-board'),
  ('ziprecruiter.com','ZipRecruiter','job-board'),
  ('careerbuilder.com','CareerBuilder','job-board'),
  ('naukri.com','Naukri','job-board'),
  ('jobcase.com','Jobcase','community'),
  ('wayup.com','WayUp','job-board')
ON CONFLICT (domain) DO NOTHING;

ALTER TABLE public.career_site_benchmark_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Benchmark domains are readable by members" ON public.career_site_benchmark_domains;
CREATE POLICY "Benchmark domains are readable by members"
  ON public.career_site_benchmark_domains FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 3. The career-site property, detected from citations
-- ---------------------------------------------------------------------------
--
-- A career site is a property, not a domain: PepsiCo's is pepsicojobs.com
-- plus life./stories. subdomains plus pepjobs.mypepsico.com. A domain joins
-- the property when it carries a brand token AND a careers token, which
-- keeps the corporate site (pepsico.com, about.netflix.com) and the long
-- tail of dealer/franchise sites out. Junk shapes are rejected first:
-- some citations leak a URL-encoded path into the domain field
-- ("jobs.netflix.com%2fculture") or a truncated host ("jobs.netflix.c"),
-- and non-production hosts (wwwqa.careers.ford.com) never rank.
--
-- companies.settings->>'career_site_domains' (a JSON array) overrides
-- detection entirely for clients whose property we cannot infer.

CREATE TABLE IF NOT EXISTS public.company_career_domains_mv (
  company_id    uuid   NOT NULL,
  domain        text   NOT NULL,
  citations     bigint NOT NULL DEFAULT 0,
  is_primary    boolean NOT NULL DEFAULT false,
  source        text   NOT NULL DEFAULT 'detected',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, domain)
);

ALTER TABLE public.company_career_domains_mv ENABLE ROW LEVEL SECURITY;
-- No policies: reads go through the SECURITY DEFINER RPCs only.

CREATE OR REPLACE FUNCTION public._refresh_cm_career_domains(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_career_domains_mv', 0));
  DELETE FROM public.company_career_domains_mv
   WHERE (p_company_id IS NULL OR company_id = p_company_id);

  INSERT INTO public.company_career_domains_mv
    (company_id, domain, citations, is_primary, source, calculated_at)
  WITH scope AS (
    SELECT c.id,
           regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') AS brand_token,
           COALESCE(
             ARRAY(SELECT lower(btrim(v::text, '"'))
                     FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(c.settings->'career_site_domains') = 'array'
                                 THEN c.settings->'career_site_domains' ELSE '[]'::jsonb END) v),
             '{}'::text[]) AS overrides
    FROM companies c
    WHERE (p_company_id IS NULL OR c.id = p_company_id)
  ),
  cited AS (
    SELECT pr.company_id,
           lower(regexp_replace(c.value->>'domain', '^www\.', '')) AS domain,
           count(*) AS citations
    FROM prompt_responses pr
    JOIN scope s ON s.id = pr.company_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.canonical_citations, pr.citations)) c
    WHERE jsonb_typeof(COALESCE(pr.canonical_citations, pr.citations)) = 'array'
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    GROUP BY 1, 2
  ),
  valid AS (
    SELECT * FROM cited
    WHERE domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'   -- a real host, not an encoded path
      AND domain !~ '^(wwwqa|qa|stage|staging|uat|dev|test)\.'
  ),
  matched AS (
    SELECT v.company_id, v.domain, v.citations,
           CASE WHEN v.domain = ANY (s.overrides) THEN 'override' ELSE 'detected' END AS source
    FROM valid v
    JOIN scope s ON s.id = v.company_id
    WHERE v.domain = ANY (s.overrides)
       OR (COALESCE(array_length(s.overrides, 1), 0) = 0
           AND s.brand_token <> ''
           AND v.domain LIKE '%' || s.brand_token || '%'
           AND v.domain ~ '(job|career|apply|talent|recruit|hiring|workday)')
  )
  SELECT company_id, domain, citations,
         row_number() OVER (PARTITION BY company_id ORDER BY citations DESC, domain) = 1,
         source, now()
  FROM matched;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Topic ownership cube — the tab's headline signal
-- ---------------------------------------------------------------------------
--
-- Per attribute: how many answers we measured, how many cited the career-site
-- property, and how many cited a benchmark domain. An answer can do both;
-- the shares are independent, not a split of 100%.

CREATE TABLE IF NOT EXISTS public.company_career_topic_stats_mv (
  company_id           uuid   NOT NULL,
  attribute_id         text   NOT NULL,
  response_month       date   NOT NULL,
  location_context     text   NOT NULL DEFAULT '',
  job_function_context text   NOT NULL DEFAULT '',
  answers              bigint NOT NULL DEFAULT 0,
  answers_owned        bigint NOT NULL DEFAULT 0,
  answers_benchmark    bigint NOT NULL DEFAULT 0,
  calculated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_career_topic_company
  ON public.company_career_topic_stats_mv (company_id, response_month);

ALTER TABLE public.company_career_topic_stats_mv ENABLE ROW LEVEL SECURITY;
-- No policies: reads go through the SECURITY DEFINER RPCs only.

CREATE OR REPLACE FUNCTION public._refresh_cm_career_topic_stats(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_career_topic_stats_mv', 0));
  DELETE FROM public.company_career_topic_stats_mv
   WHERE (p_company_id IS NULL OR company_id = p_company_id);

  INSERT INTO public.company_career_topic_stats_mv
    (company_id, attribute_id, response_month, location_context, job_function_context,
     answers, answers_owned, answers_benchmark, calculated_at)
  WITH rows AS (
    SELECT pr.id, pr.company_id,
           COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date) AS response_month,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS location_context,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
           lower(btrim(cp.attribute_id)) AS attribute_id,
           COALESCE(pr.canonical_citations, pr.citations) AS cites
    FROM prompt_responses pr
    JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.company_id IS NOT NULL AND pr.tested_at IS NOT NULL
      AND (p_company_id IS NULL OR pr.company_id = p_company_id)
      AND pr.ai_model NOT IN ('claude','gemini','deepseek')
      AND COALESCE(btrim(cp.attribute_id), '') <> ''
      AND lower(COALESCE(btrim(cp.attribute_id), '')) <> 'overall-candidate-experience'
      AND lower(COALESCE(btrim(cp.prompt_theme), '')) <> 'overall candidate experience'
  ),
  flagged AS (
    SELECT r.id, r.company_id, r.attribute_id, r.response_month,
           r.location_context, r.job_function_context,
           EXISTS (
             SELECT 1 FROM jsonb_array_elements(r.cites) c
             JOIN company_career_domains_mv d
               ON d.company_id = r.company_id
              AND d.domain = lower(regexp_replace(c.value->>'domain', '^www\.', ''))
             WHERE jsonb_typeof(r.cites) = 'array'
           ) AS owned,
           EXISTS (
             SELECT 1 FROM jsonb_array_elements(r.cites) c
             JOIN career_site_benchmark_domains b
               ON lower(regexp_replace(c.value->>'domain', '^www\.', '')) = b.domain
               OR lower(regexp_replace(c.value->>'domain', '^www\.', '')) LIKE '%.' || b.domain
             WHERE jsonb_typeof(r.cites) = 'array'
           ) AS benchmark
    FROM rows r
  )
  SELECT company_id, attribute_id, response_month, location_context, job_function_context,
         count(*),
         count(*) FILTER (WHERE owned),
         count(*) FILTER (WHERE benchmark),
         now()
  FROM flagged
  GROUP BY company_id, attribute_id, response_month, location_context, job_function_context;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Quoted passages — section-level evidence, where it exists
-- ---------------------------------------------------------------------------
--
-- Google AI Overviews and AI Mode append a `#:~:text=` scroll-to-text
-- fragment naming the exact passage they lifted; no other platform does, so
-- coverage is real but partial and uneven by client. The raw fragment is
-- stored verbatim and parsed client-side, where it is matched against the
-- rendered capture to place a highlight.

CREATE TABLE IF NOT EXISTS public.company_career_passages_mv (
  company_id     uuid   NOT NULL,
  url            text   NOT NULL,
  fragment       text   NOT NULL,
  ai_model       text   NOT NULL,
  response_month date   NOT NULL,
  occurrences    bigint NOT NULL DEFAULT 0,
  calculated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_career_passages_company_url
  ON public.company_career_passages_mv (company_id, url);

ALTER TABLE public.company_career_passages_mv ENABLE ROW LEVEL SECURITY;
-- No policies: reads go through the SECURITY DEFINER RPCs only.

CREATE OR REPLACE FUNCTION public._refresh_cm_career_passages(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cm_refresh:company_career_passages_mv', 0));
  DELETE FROM public.company_career_passages_mv
   WHERE (p_company_id IS NULL OR company_id = p_company_id);

  INSERT INTO public.company_career_passages_mv
    (company_id, url, fragment, ai_model, response_month, occurrences, calculated_at)
  SELECT pr.company_id,
         public.career_site_canonical_page(c.value->>'url'),
         substring(c.value->>'url' from '#:~:text=(.*)$'),
         pr.ai_model,
         COALESCE(pr.response_month, date_trunc('month', pr.tested_at)::date),
         count(*),
         now()
  FROM prompt_responses pr
  JOIN company_career_domains_mv d
    ON d.company_id = pr.company_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.canonical_citations, pr.citations)) c
  WHERE jsonb_typeof(COALESCE(pr.canonical_citations, pr.citations)) = 'array'
    AND (p_company_id IS NULL OR pr.company_id = p_company_id)
    AND pr.tested_at IS NOT NULL
    AND pr.ai_model NOT IN ('claude','gemini','deepseek')
    AND lower(regexp_replace(c.value->>'domain', '^www\.', '')) = d.domain
    AND c.value->>'url' LIKE '%#:~:text=%'
  GROUP BY 1, 2, 3, 4, 5;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Refresh wiring
-- ---------------------------------------------------------------------------
--
-- Order matters: the topic and passage cubes read company_career_domains_mv,
-- so the property is rebuilt first.

CREATE OR REPLACE FUNCTION public._refresh_cm_career_site(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public._refresh_cm_career_domains(p_company_id);
  PERFORM public._refresh_cm_career_topic_stats(p_company_id);
  PERFORM public._refresh_cm_career_passages(p_company_id);
END $$;

CREATE OR REPLACE FUNCTION public._refresh_cm_dispatch(p_mv_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  CASE p_mv_name
    WHEN 'company_sentiment_scores_mv'          THEN PERFORM public._refresh_cm_sentiment_scores(NULL);
    WHEN 'company_relevance_scores_mv'          THEN PERFORM public._refresh_cm_relevance_scores(NULL);
    WHEN 'company_top_sources_mv'               THEN PERFORM public._refresh_cm_top_sources(NULL);
    WHEN 'company_competitors_mv'               THEN PERFORM public._refresh_cm_competitors(NULL);
    WHEN 'company_llm_rankings_mv'              THEN PERFORM public._refresh_cm_llm_rankings(NULL);
    WHEN 'company_attribute_themes_mv'          THEN PERFORM public._refresh_cm_attribute_themes(NULL);
    WHEN 'company_response_sentiment_mv'        THEN PERFORM public._refresh_cm_response_sentiment(NULL);
    WHEN 'company_scope_stats_mv'               THEN PERFORM public._refresh_cm_scope_stats(NULL);
    WHEN 'company_scope_daily_stats_mv'         THEN PERFORM public._refresh_cm_scope_daily_stats(NULL);
    WHEN 'company_scope_prompt_type_stats_mv'   THEN PERFORM public._refresh_cm_scope_prompt_type_stats(NULL);
    WHEN 'company_llm_stats_mv'                 THEN PERFORM public._refresh_cm_llm_stats(NULL);
    WHEN 'company_domain_stats_mv'              THEN PERFORM public._refresh_cm_domain_stats(NULL);
    WHEN 'company_career_site_mv'               THEN PERFORM public._refresh_cm_career_site(NULL);
    ELSE EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', p_mv_name);
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_company_metrics(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required; use refresh_company_metrics() for a full rebuild';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_company_metrics:' || p_company_id::text, 0));
  PERFORM public._refresh_cm_sentiment_scores(p_company_id);
  PERFORM public._refresh_cm_relevance_scores(p_company_id);
  PERFORM public._refresh_cm_top_sources(p_company_id);
  PERFORM public._refresh_cm_competitors(p_company_id);
  PERFORM public._refresh_cm_llm_rankings(p_company_id);
  PERFORM public._refresh_cm_attribute_themes(p_company_id);
  PERFORM public._refresh_cm_response_sentiment(p_company_id);
  PERFORM public._refresh_cm_scope_stats(p_company_id);
  PERFORM public._refresh_cm_scope_daily_stats(p_company_id);
  PERFORM public._refresh_cm_scope_prompt_type_stats(p_company_id);
  PERFORM public._refresh_cm_llm_stats(p_company_id);
  PERFORM public._refresh_cm_domain_stats(p_company_id);
  PERFORM public._refresh_cm_career_site(p_company_id);
  DELETE FROM public.company_metrics_dirty WHERE company_id = p_company_id;
END $$;

INSERT INTO public.mv_refresh_state (mv_name)
SELECT t FROM unnest(ARRAY['company_career_site_mv']) AS t
WHERE NOT EXISTS (SELECT 1 FROM public.mv_refresh_state s WHERE s.mv_name = t);

-- ---------------------------------------------------------------------------
-- 7. Reads
-- ---------------------------------------------------------------------------
--
-- Location follows the get_domain_stats convention: owned profiles read a
-- widened bucket list, other profiles read only the selection's spellings;
-- p_owned_buckets = NULL means "all locations".

CREATE OR REPLACE FUNCTION public.get_career_site_overview(
  p_owned_ids uuid[],
  p_owned_buckets text[] DEFAULT NULL,
  p_other_ids uuid[] DEFAULT '{}',
  p_other_buckets text[] DEFAULT '{}',
  p_months date[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH jobs AS (
    SELECT unnest(public.accessible_company_ids(p_owned_ids)) AS company_id,
           p_owned_buckets AS buckets
    UNION ALL
    SELECT unnest(public.accessible_company_ids(p_other_ids)) AS company_id,
           p_other_buckets AS buckets
    WHERE COALESCE(array_length(p_other_buckets, 1), 0) > 0
  ),
  property AS (
    SELECT d.domain, sum(d.citations) AS citations, bool_or(d.is_primary) AS is_primary,
           min(d.source) AS source
    FROM jobs j
    JOIN company_career_domains_mv d ON d.company_id = j.company_id
    GROUP BY d.domain
  ),
  pages_raw AS (
    SELECT public.career_site_canonical_page(t.url) AS url,
           t.response_month,
           sum(t.responses_citing) AS responses_citing,
           max(t.title) FILTER (WHERE t.title IS NOT NULL) AS title
    FROM jobs j
    JOIN company_page_stats_mv t
      ON t.company_id = j.company_id
     AND (j.buckets IS NULL OR t.location_context = ANY (j.buckets))
    JOIN property p ON p.domain = t.domain
    WHERE (p_months IS NULL OR t.response_month = ANY (p_months))
      AND public.career_site_canonical_page(t.url) IS NOT NULL
    GROUP BY 1, 2
  ),
  top_pages AS (
    SELECT url FROM pages_raw
    GROUP BY url
    ORDER BY sum(responses_citing) DESC, url
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  ),
  scope_totals AS (
    SELECT t.response_month, sum(t.total_responses) AS total_responses
    FROM jobs j
    JOIN company_scope_stats_mv t
      ON t.company_id = j.company_id
     AND (j.buckets IS NULL OR t.location_context = ANY (j.buckets))
    WHERE (p_months IS NULL OR t.response_month = ANY (p_months))
      AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'domains', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'domain', p.domain, 'citations', p.citations,
        'is_primary', p.is_primary, 'source', p.source)
        ORDER BY p.citations DESC)
      FROM property p), '[]'::jsonb),
    'pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'url', r.url, 'response_month', r.response_month,
        'responses_citing', r.responses_citing, 'title', r.title,
        'page_kind', public.career_site_page_kind(r.url)))
      FROM pages_raw r JOIN top_pages t ON t.url = r.url), '[]'::jsonb),
    'scope_totals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'response_month', s.response_month, 'total_responses', s.total_responses))
      FROM scope_totals s), '[]'::jsonb),
    'page_total', (SELECT count(DISTINCT url) FROM pages_raw)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_career_site_gaps(
  p_owned_ids uuid[],
  p_owned_buckets text[] DEFAULT NULL,
  p_other_ids uuid[] DEFAULT '{}',
  p_other_buckets text[] DEFAULT '{}',
  p_months date[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH jobs AS (
    SELECT unnest(public.accessible_company_ids(p_owned_ids)) AS company_id,
           p_owned_buckets AS buckets
    UNION ALL
    SELECT unnest(public.accessible_company_ids(p_other_ids)) AS company_id,
           p_other_buckets AS buckets
    WHERE COALESCE(array_length(p_other_buckets, 1), 0) > 0
  ),
  filtered AS (
    SELECT t.attribute_id, t.response_month,
           sum(t.answers)           AS answers,
           sum(t.answers_owned)     AS answers_owned,
           sum(t.answers_benchmark) AS answers_benchmark
    FROM jobs j
    JOIN company_career_topic_stats_mv t
      ON t.company_id = j.company_id
     AND (j.buckets IS NULL OR t.location_context = ANY (j.buckets))
    WHERE (p_months IS NULL OR t.response_month = ANY (p_months))
      AND (p_job_functions IS NULL OR t.job_function_context = ANY (p_job_functions))
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attribute_id', f.attribute_id, 'response_month', f.response_month,
        'answers', f.answers, 'answers_owned', f.answers_owned,
        'answers_benchmark', f.answers_benchmark))
      FROM filtered f), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_career_site_passages(
  p_owned_ids uuid[],
  p_url text DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'url', p.url, 'fragment', p.fragment, 'ai_model', p.ai_model,
      'occurrences', sum(p.occurrences)) AS r
    FROM company_career_passages_mv p
    WHERE p.company_id = ANY (public.accessible_company_ids(p_owned_ids))
      AND (p_url IS NULL OR p.url = p_url)
      AND (p_months IS NULL OR p.response_month = ANY (p_months))
    GROUP BY p.url, p.fragment, p.ai_model
    ORDER BY sum(p.occurrences) DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  ) s;
$$;

REVOKE ALL ON FUNCTION public.get_career_site_overview(uuid[], text[], uuid[], text[], date[], text[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_career_site_overview(uuid[], text[], uuid[], text[], date[], text[], int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_career_site_gaps(uuid[], text[], uuid[], text[], date[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_career_site_gaps(uuid[], text[], uuid[], text[], date[], text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_career_site_passages(uuid[], text, date[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_career_site_passages(uuid[], text, date[], int) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8. Page captures — what the preview pane renders
-- ---------------------------------------------------------------------------
--
-- Career sites cannot be iframed: every one we checked (pepsicojobs.com,
-- careers.ford.com, jobs.netflix.com, disneycareers.com, careers.microsoft.com)
-- sends X-Frame-Options DENY or SAMEORIGIN, so pointing an iframe at the live
-- site renders nothing. The preview instead serves a stored capture of the
-- page from our own origin, which sidesteps the header and — because the
-- markup is ours to measure — lets the client compute real bounding boxes for
-- the passages AI quoted, which a cross-origin frame could never expose.
--
-- `html` is stored already sanitized by the capture function (scripts,
-- iframes, event handlers and javascript: URLs removed). It is rendered in a
-- sandboxed frame with scripts disabled; see CareerSitePreview.tsx.

CREATE TABLE IF NOT EXISTS public.career_site_captures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  url            text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  html           text,
  base_url       text,
  screenshot_url text,
  title          text,
  error          text,
  captured_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_site_captures_status_chk
    CHECK (status IN ('pending','ready','failed')),
  CONSTRAINT career_site_captures_company_url_key UNIQUE (company_id, url)
);
CREATE INDEX IF NOT EXISTS idx_career_site_captures_company
  ON public.career_site_captures (company_id, updated_at DESC);

ALTER TABLE public.career_site_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can read their captures" ON public.career_site_captures;
CREATE POLICY "Org members can read their captures"
  ON public.career_site_captures FOR SELECT TO authenticated
  USING (company_id = ANY (public.accessible_company_ids(ARRAY[company_id])));

-- Writes are service-role only: the capture edge function owns this table.

-- Backfill via the throttled dirty queue, as the other cube migrations do.
SELECT public.queue_all_companies_metrics_dirty();
