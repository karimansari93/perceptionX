-- ============================================================
-- Cleanup: remove TalentX branding + subscription/pro tiers (core)
-- Everyone is a single user type; attributes are just "attributes".
-- ============================================================

-- 1. prompt_type: strip the talentx_ prefix so values are just the 4 intents
ALTER TABLE public.confirmed_prompts DROP CONSTRAINT IF EXISTS confirmed_prompts_prompt_type_check;

UPDATE public.confirmed_prompts
  SET prompt_type = regexp_replace(prompt_type, '^talentx_', '')
  WHERE prompt_type LIKE 'talentx_%';

ALTER TABLE public.confirmed_prompts
  ADD CONSTRAINT confirmed_prompts_prompt_type_check
  CHECK (prompt_type = ANY (ARRAY['informational','experience','competitive','discovery']));

-- 2. Rename talentx_ attribute columns -> attribute_*
ALTER TABLE public.ai_themes RENAME COLUMN talentx_attribute_id TO attribute_id;
ALTER TABLE public.ai_themes RENAME COLUMN talentx_attribute_name TO attribute_name;
ALTER TABLE public.confirmed_prompts RENAME COLUMN talentx_attribute_id TO attribute_id;

-- 3. Drop dead / pro columns (nobody is "pro" anymore)
ALTER TABLE public.confirmed_prompts DROP COLUMN IF EXISTS talentx_prompt_type;  -- all NULL
ALTER TABLE public.confirmed_prompts DROP COLUMN IF EXISTS is_pro_prompt;        -- vestigial, no dependents

-- 4. Recreate theme_analysis_summary view with clean naming
DROP VIEW IF EXISTS public.theme_analysis_summary;
CREATE VIEW public.theme_analysis_summary AS
 SELECT pr.id AS response_id,
    pr.response_text,
    pr.ai_model,
    pr.tested_at,
    cp.prompt_text,
    cp.prompt_category,
    count(at.id) AS total_themes,
    count(CASE WHEN at.sentiment = 'positive'::text THEN 1 ELSE NULL::integer END) AS positive_themes,
    count(CASE WHEN at.sentiment = 'negative'::text THEN 1 ELSE NULL::integer END) AS negative_themes,
    count(CASE WHEN at.sentiment = 'neutral'::text THEN 1 ELSE NULL::integer END) AS neutral_themes,
    avg(at.sentiment_score) AS avg_sentiment_score,
    avg(at.confidence_score) AS avg_confidence_score,
    array_agg(DISTINCT at.attribute_name) FILTER (WHERE at.attribute_name IS NOT NULL) AS attributes_covered
   FROM prompt_responses pr
     LEFT JOIN ai_themes at ON pr.id = at.response_id
     LEFT JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  GROUP BY pr.id, pr.response_text, pr.ai_model, pr.tested_at, cp.prompt_text, cp.prompt_category;

-- 5. Update source_citation_stats dimension CHECK to use 'attribute' instead of 'talentx_attribute'
ALTER TABLE public.source_citation_stats DROP CONSTRAINT IF EXISTS source_citation_stats_dimension_check;
UPDATE public.source_citation_stats SET dimension = 'attribute' WHERE dimension = 'talentx_attribute';
ALTER TABLE public.source_citation_stats
  ADD CONSTRAINT source_citation_stats_dimension_check
  CHECK (dimension = ANY (ARRAY['global','industry','job_function','location','theme','attribute']));

-- 6. Recreate refresh_source_citation_stats with attribute_name + 'attribute' dimension
CREATE OR REPLACE FUNCTION public.refresh_source_citation_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  create temporary table _cite_base on commit drop as
  select
    pr.id                     as response_id,
    pr.company_id             as company_id,
    sd.family_id              as family_id,
    cp.industry_context       as industry_context,
    cp.job_function_context   as job_function_context,
    cp.location_context       as location_context,
    cp.prompt_theme           as prompt_theme
  from public.prompt_responses pr
  cross join lateral jsonb_array_elements(pr.citations) c
  join public.source_domains sd
    on sd.domain = lower(c->>'domain')
   and sd.family_id is not null
  left join public.confirmed_prompts cp
    on cp.id = pr.confirmed_prompt_id
  where jsonb_typeof(pr.citations) = 'array'
    and c->>'domain' is not null;

  create index on _cite_base (response_id);

  delete from public.source_citation_stats;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'global', '',
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  group by family_id;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'industry', industry_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where industry_context is not null and industry_context <> ''
  group by family_id, industry_context;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'job_function', job_function_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where job_function_context is not null and job_function_context <> ''
  group by family_id, job_function_context;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'location', location_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where location_context is not null and location_context <> ''
  group by family_id, location_context;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'theme', prompt_theme,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where prompt_theme is not null and prompt_theme <> ''
  group by family_id, prompt_theme;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select b.family_id, 'attribute', t.attribute_name,
         count(*), count(distinct b.response_id), count(distinct b.company_id)
  from _cite_base b
  join (
    select distinct response_id, attribute_name
    from public.ai_themes
    where attribute_name is not null and attribute_name <> ''
  ) t on t.response_id = b.response_id
  group by b.family_id, t.attribute_name;
end;
$function$;

-- 7. Remove subscription/pro tiers from the data model (everyone is one user type)
ALTER TABLE public.profiles        DROP COLUMN IF EXISTS subscription_type;
ALTER TABLE public.profiles        DROP COLUMN IF EXISTS subscription_start_date;
ALTER TABLE public.profiles        DROP COLUMN IF EXISTS prompts_used;
ALTER TABLE public.user_onboarding DROP COLUMN IF EXISTS subscription_type;
ALTER TABLE public.user_onboarding DROP COLUMN IF EXISTS subscription_start_date;
ALTER TABLE public.user_onboarding DROP COLUMN IF EXISTS prompts_used;
DROP TYPE IF EXISTS public.subscription_type;
