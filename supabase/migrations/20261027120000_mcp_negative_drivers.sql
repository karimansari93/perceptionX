-- Where the negatives come from (px-tools get_negative_drivers, 2026-10-27).
--
-- The playbook's first question for any weak topic is which attributes hold
-- the largest share of the employer's negative opinions, and how much of
-- that sits in answers that cite the employer's own review-profile pages.
-- The attribute shares come from the attribute cube (mcp_get_rollups); this
-- read adds the review-profile half:
--
--   * pool: the scope's answers that carry at least one negative theme, on
--     the published models, in the requested months, markets and job
--     functions;
--   * sampled: up to p_sample of them per response_month, at random (the
--     same budget shape as mcp_get_theme_stats), so a brand-wide two-wave
--     scope stays well inside the 20 s service_role budget (about 5 s on
--     the largest scope at the time of writing);
--   * profile_cites: citations in the sampled answers that sit on a review
--     platform's profile path AND carry one of the brand's own slug tokens
--     (p_brand_tokens, derived from the brand name by the executor, never a
--     hard-coded client). Glassdoor employer pages (reviews, interviews,
--     benefits, culture; not job listings), Indeed /cmp/<slug>, kununu
--     /<country>/<slug>, AmbitionBox, Undelucram, profession.hu,
--     WhereWeWork and Computrabajo with the slug in the path, Seek and
--     Jobstreet /companies/<slug>, Infojobs Brazil /<slug>, Comparably
--     /companies/<slug>;
--   * rows: the sampled answers' negative themes per month and attribute,
--     split by whether the answer cites such a page;
--   * months: pool size, sample size, answers citing a profile, and the
--     classifier versions seen (so the executor can warn when periods are
--     not on one version);
--   * profile_pages: the matched pages cited most, so the match can be
--     checked and linked.
--
-- Service-role only, like every mcp_* read. Scoped to company ids and
-- months: it never scans prompt_responses as a whole.

CREATE OR REPLACE FUNCTION public.mcp_get_negative_drivers(
  p_company_ids uuid[],
  p_brand_tokens text[],
  p_buckets text[] DEFAULT NULL,
  p_months date[] DEFAULT NULL,
  p_job_functions text[] DEFAULT NULL,
  p_sample int DEFAULT 2000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tokens AS (
    SELECT regexp_replace(lower(btrim(t)), '[^a-z0-9-]', '', 'g') AS tk
    FROM unnest(COALESCE(p_brand_tokens, ARRAY[]::text[])) t
    WHERE length(regexp_replace(lower(btrim(t)), '[^a-z0-9-]', '', 'g')) >= 3
  ),
  neg_resp AS (
    SELECT DISTINCT t.response_id AS id
    FROM public.ai_themes t
    WHERE t.company_id = ANY (p_company_ids)
      AND t.sentiment = 'negative'
  ),
  pool AS (
    SELECT pr.id, pr.response_month
    FROM neg_resp nr
    JOIN public.prompt_responses pr ON pr.id = nr.id
    JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
    WHERE pr.for_index IS NOT TRUE
      AND public.is_published_model(pr.ai_model, pr.response_month)
      AND (p_months IS NULL OR pr.response_month = ANY (p_months))
      AND (p_buckets IS NULL OR COALESCE(NULLIF(btrim(cp.location_context), ''), '') = ANY (p_buckets))
      AND (p_job_functions IS NULL OR COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') = ANY (p_job_functions))
  ),
  sampled AS (
    SELECT id, response_month
    FROM (
      SELECT pool.id, pool.response_month,
             row_number() OVER (PARTITION BY pool.response_month ORDER BY random()) AS rn
      FROM pool
    ) s
    WHERE s.rn <= LEAST(GREATEST(COALESCE(p_sample, 2000), 100), 5000)
  ),
  cites AS (
    SELECT s.id, s.response_month,
           lower(regexp_replace(c.value->>'domain', '^(www|m)\.', '')) AS domain,
           regexp_replace(regexp_replace(lower(c.value->>'url'), '^https?://[^/]+', ''), '[?#].*$', '') AS path,
           public.mcp_normalize_cited_url(c.value->>'url') AS url
    FROM sampled s
    JOIN public.prompt_responses pr ON pr.id = s.id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(COALESCE(pr.canonical_citations, pr.citations)) = 'array'
           THEN COALESCE(pr.canonical_citations, pr.citations) ELSE '[]'::jsonb END) c(value)
    WHERE COALESCE(c.value->>'domain', '') <> ''
  ),
  profile_cites AS (
    SELECT c.id, c.response_month, c.domain, c.url
    FROM cites c
    WHERE (
         (c.domain ~ '(^|\.)glassdoor\.' AND c.path ~ '^/[^/]+/[^/]+'
            AND c.path !~ '^/(job-listing|jobs|job|partner|community|blog|employers|research|salary|salaries)/')
      OR (c.domain ~ '(^|\.)indeed\.' AND c.path ~ '^/cmp/')
      OR (c.domain ~ '(^|\.)kununu\.' AND c.path ~ '^/[a-z]{2}/[^/]+')
      OR (c.domain ~ '(^|\.)ambitionbox\.' AND c.path ~ '^/[^/]+/[^/]+' AND c.path !~ '^/jobs/')
      OR (c.domain ~ '(^|\.)undelucram\.' AND c.path ~ '^/[a-z]{2}/[^/]+')
      OR (c.domain ~ '(^|\.)profession\.hu$' AND c.path ~ '^/cegek/')
      OR (c.domain ~ '(^|\.)wherewework\.' AND c.path ~ '^/([a-z]{2}/)?[^/]+')
      OR (c.domain ~ '(^|\.)computrabajo\.' AND c.path ~ '^/empresas')
      OR (c.domain ~ '(^|\.)(seek|jobstreet)\.' AND c.path ~ '^/companies/')
      OR (c.domain ~ '(^|\.)infojobs\.' AND c.path ~ '^/[^/]+')
      OR (c.domain ~ '(^|\.)comparably\.' AND c.path ~ '^/companies/')
    )
    AND EXISTS (
      SELECT 1 FROM tokens
      WHERE c.path ~ ('(^|/|-|_)' || tokens.tk || '(-|_|/|\.|$)')
    )
  ),
  flagged AS (
    SELECT s.id, s.response_month,
           EXISTS (SELECT 1 FROM profile_cites pc WHERE pc.id = s.id) AS cites_profile
    FROM sampled s
  ),
  neg_themes AS (
    SELECT f.response_month, lower(btrim(t.attribute_id)) AS attribute_id, f.cites_profile, t.classifier_version
    FROM flagged f
    JOIN public.ai_themes t ON t.response_id = f.id
    WHERE t.sentiment = 'negative'
  )
  SELECT jsonb_build_object(
    'months', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.response_month)
      FROM (
        SELECT p.response_month,
               count(*) AS answers_with_negatives,
               (SELECT count(*) FROM flagged f WHERE f.response_month = p.response_month) AS answers_sampled,
               (SELECT count(*) FROM flagged f WHERE f.response_month = p.response_month AND f.cites_profile) AS answers_sampled_citing_profile,
               COALESCE((SELECT array_agg(DISTINCT COALESCE(n.classifier_version, 'unversioned'))
                         FROM neg_themes n WHERE n.response_month = p.response_month), ARRAY[]::text[]) AS versions
        FROM pool p
        GROUP BY p.response_month
      ) x
    ), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT response_month, attribute_id,
               count(*) AS negative_themes,
               count(*) FILTER (WHERE cites_profile) AS negative_themes_in_profile_answers
        FROM neg_themes
        GROUP BY 1, 2
      ) x
    ), '[]'::jsonb),
    'profile_pages', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.answers_citing DESC, x.url)
      FROM (
        SELECT domain, url, count(DISTINCT id) AS answers_citing
        FROM profile_cites
        WHERE url IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 3 DESC, 2
        LIMIT 12
      ) x
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.mcp_get_negative_drivers(uuid[], text[], text[], date[], text[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_negative_drivers(uuid[], text[], text[], date[], text[], int) TO service_role;
