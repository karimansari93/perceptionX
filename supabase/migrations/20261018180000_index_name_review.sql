-- Company names from the new Index countries: size label, "is this an
-- employer?" and "same employer as an existing Index entry?" in one Claude
-- Haiku batch pass (Karim, 2026-10-18: "ok go", quoted at ~$0.30-0.50 for the
-- ~7,000 names mentioned at least twice). The edge function index-name-review
-- submits and collects; results are stored here and applied separately after
-- review.

CREATE TABLE IF NOT EXISTS public.index_name_review (
  name text PRIMARY KEY,          -- the name as the Index would show it
  mentions integer NOT NULL,      -- industry-wide answers that name it
  countries text[] NOT NULL,
  industries text[] NOT NULL,
  candidates text[] NOT NULL DEFAULT '{}',  -- Index entries it may duplicate (a-e)
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'submitted', 'stored', 'failed', 'applied', 'skipped')),
  batch_id text,
  custom_id text,
  request_pos integer,
  tier text,
  is_employer boolean,
  same_as text,                   -- candidate letter a-e
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS index_name_review_custom_idx
  ON public.index_name_review (custom_id, request_pos);

CREATE TABLE IF NOT EXISTS public.index_name_review_batches (
  batch_id text PRIMARY KEY,
  key_slot text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'collected')),
  requests integer NOT NULL,
  names integer NOT NULL,
  usage jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz
);

-- Current Index entries with a trigram index, so the duplicate shortlist is a
-- quick index lookup per name instead of a scan of every entry.
CREATE TABLE IF NOT EXISTS public.index_name_review_entries (name text PRIMARY KEY);
CREATE INDEX IF NOT EXISTS index_name_review_entries_trgm
  ON public.index_name_review_entries USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS index_name_review_entries_lower
  ON public.index_name_review_entries (lower(name) text_pattern_ops);
ALTER TABLE public.index_name_review_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.index_name_review_entries FROM anon, authenticated;

ALTER TABLE public.index_name_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.index_name_review_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.index_name_review, public.index_name_review_batches FROM anon, authenticated;

-- Names that would show on the Index from the new countries' industry-wide
-- answers, have no size label and are not excluded, with up to five similar
-- existing Index entries as duplicate candidates.
CREATE OR REPLACE FUNCTION public.queue_index_name_review(p_min_mentions integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900000'
AS $function$
DECLARE
  v_n int;
BEGIN
  PERFORM set_config('pg_trgm.similarity_threshold', '0.45', true);

  WITH raw AS (
    SELECT clean_company_name(t) AS n, ip.country, ip.industry, ir.id AS rid
    FROM index_responses ir
    JOIN index_prompts ip ON ip.id = ir.index_prompt_id
    CROSS JOIN LATERAL regexp_split_to_table(ir.detected_competitors, '[,;\n]+') AS t
    WHERE ip.job_function IS NULL AND ir.index_period IS NULL
      AND ir.detected_competitors IS NOT NULL AND length(btrim(t)) > 1
  ), named AS (
    SELECT coalesce(c.canonical_name, initcap(r.n)) AS name, r.country, r.industry, r.rid
    FROM raw r
    LEFT JOIN company_canonical_names c ON lower(c.variant_name) = r.n
  ), agg AS (
    SELECT name, count(DISTINCT rid)::int AS mentions,
           array_agg(DISTINCT country) AS countries, array_agg(DISTINCT industry) AS industries
    FROM named
    WHERE length(btrim(name)) > 1
    GROUP BY name
  )
  INSERT INTO index_name_review (name, mentions, countries, industries)
  SELECT a.name, a.mentions, a.countries, a.industries
  FROM agg a
  WHERE a.mentions >= p_min_mentions
    AND NOT EXISTS (SELECT 1 FROM company_employee_tiers t WHERE lower(t.company_name) = lower(a.name))
    AND NOT EXISTS (SELECT 1 FROM company_overrides o
                    WHERE lower(o.canonical_name) = lower(a.name) AND o.status = 'excluded')
  ON CONFLICT (name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO index_name_review_entries (name)
  SELECT canonical_name FROM company_search_index
  ON CONFLICT (name) DO NOTHING;

  -- Similar spellings (trigram index) plus entries the name starts with
  -- ("Samsung Electronics Korea" -> Samsung): every leading run of words.
  UPDATE index_name_review r
  SET candidates = c.cands
  FROM (
    SELECT q.name, (array_agg(e.f ORDER BY e.score DESC))[1:5] AS cands
    FROM index_name_review q
    CROSS JOIN LATERAL (
      SELECT x.f, max(x.score) AS score
      FROM (
        SELECT s.name AS f, similarity(lower(s.name), lower(q.name)) AS score
        FROM index_name_review_entries s
        WHERE lower(s.name) % lower(q.name)
        UNION ALL
        SELECT s.name, 1 + length(p.prefix)
        FROM generate_series(1, 4) AS w(n)
        CROSS JOIN LATERAL (
          SELECT array_to_string((regexp_split_to_array(lower(q.name), '\s+'))[1:w.n], ' ') AS prefix
        ) p
        JOIN index_name_review_entries s ON lower(s.name) = p.prefix
        WHERE p.prefix <> lower(q.name)
      ) x
      WHERE lower(x.f) <> lower(q.name)
      GROUP BY x.f
      ORDER BY 2 DESC
      LIMIT 5
    ) e
    WHERE q.status = 'queued'
    GROUP BY q.name
  ) c
  WHERE c.name = r.name;

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.index_name_review_mark_submitted(
  p_batch_id text, p_key_slot text, p_requests integer, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  INSERT INTO index_name_review_batches (batch_id, key_slot, requests, names)
  VALUES (p_batch_id, p_key_slot, p_requests, jsonb_array_length(p_rows));

  UPDATE index_name_review r
  SET status = 'submitted', batch_id = p_batch_id, custom_id = x.custom_id,
      request_pos = x.request_pos, updated_at = now()
  FROM jsonb_to_recordset(p_rows) AS x(name text, custom_id text, request_pos integer)
  WHERE r.name = x.name;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.index_name_review_store(
  p_batch_id text, p_answers jsonb, p_failed jsonb, p_usage jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  UPDATE index_name_review r
  SET status = 'stored', tier = a.tier, is_employer = a.employer, same_as = a.same,
      error = NULL, updated_at = now()
  FROM jsonb_to_recordset(p_answers) AS a(custom_id text, request_pos integer, tier text, employer boolean, same text)
  WHERE r.batch_id = p_batch_id AND r.custom_id = a.custom_id AND r.request_pos = a.request_pos;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE index_name_review r
  SET status = 'failed', error = f.error, updated_at = now()
  FROM jsonb_to_recordset(p_failed) AS f(custom_id text, error text)
  WHERE r.batch_id = p_batch_id AND r.custom_id = f.custom_id AND r.status = 'submitted';

  -- Names the model skipped inside an otherwise good answer.
  UPDATE index_name_review
  SET status = 'failed', error = 'missing from answer', updated_at = now()
  WHERE batch_id = p_batch_id AND status = 'submitted';

  UPDATE index_name_review_batches
  SET status = 'collected', collected_at = now(), usage = p_usage
  WHERE batch_id = p_batch_id;
  RETURN v_n;
END;
$function$;

-- Kicks the edge function while names are queued or a batch is open.
CREATE OR REPLACE FUNCTION public.index_name_review_tick(p_max_requests integer DEFAULT 0)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT net.http_post(
    url := public.batch_alert_setting('supabase_url') || '/functions/v1/index-name-review',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || public.batch_alert_setting('service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('maxRequests', p_max_requests),
    timeout_milliseconds := 140000
  )
  WHERE EXISTS (SELECT 1 FROM public.index_name_review WHERE status IN ('queued', 'submitted'));
$function$;

-- Readable results: the candidate letter resolved to the Index entry.
CREATE OR REPLACE VIEW public.index_name_review_results AS
SELECT name, mentions, countries, industries, status, tier, is_employer,
       CASE WHEN same_as ~ '^[a-e]$' THEN candidates[ascii(same_as) - 96] END AS same_as_entry,
       candidates, error
FROM public.index_name_review;
REVOKE ALL ON public.index_name_review_results FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.queue_index_name_review(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_name_review_mark_submitted(text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_name_review_store(text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_name_review_tick(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.index_name_review_mark_submitted(text, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.index_name_review_store(text, jsonb, jsonb, jsonb) TO service_role;
