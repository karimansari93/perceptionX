-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260714084629; this file was
-- back-filled afterwards and therefore post-dates the deployment.

UPDATE url_recency_cache r
SET extraction_method = 'evergreen-domain',
    recency_score = 58,
    last_checked_at = now()
WHERE r.extraction_method IN ('not-found','problematic-domain')
  AND r.manually_reviewed_at IS NULL
  AND (
    lower(regexp_replace(split_part(split_part(r.url,'//',2),'/',1),'^www\.','')) ~ '(nestlejobs|flexjobs|99jobs|jobzmall|nodeflair|estagiotrainee|instahyre|iimjobs|adecco|acosta|good-people|montekservices|nlbservices|roberthalf|hays-careers|pagepersonnel|spherion|randstadusa|f6s)\.'
    OR lower(regexp_replace(split_part(split_part(r.url,'//',2),'/',1),'^www\.','')) ~ '(mondelez|ambev|nestle|heineken|coca-cola|unilever|generalmills|colgate|cargill|kimberly|redbull|keurig|danone|jnj|lilly|bcg|microsoft|accenture|amazon|thoughtworks|qure|tredence|fractal|quantiphi|bosch|datamatics)'
    OR lower(regexp_replace(split_part(split_part(r.url,'//',2),'/',1),'^www\.','')) ~ '(builtin|ensun|comparably|sloanreview|merco|greatplacetowork|library\.bu|vervoe|chainstoreage|imarcgroup|keychain|globalsources|kenresearch)'
    OR lower(regexp_replace(split_part(split_part(r.url,'//',2),'/',1),'^www\.','')) ~ '(cliffsnotes|quizlet|coursehero|boardmix|dcf-model|lockedinai|investopedia|datacamp|coursera|simplywall|thebusinessof)'
  )
  AND r.url IN (
    SELECT DISTINCT j->>'url'
    FROM prompt_responses pr
    CROSS JOIN LATERAL jsonb_array_elements(pr.citations) j
    WHERE pr.company_id = '19a134db-bdd1-466f-ba15-0f825a06e748'
      AND pr.ai_model <> 'claude'
      AND jsonb_typeof(pr.citations) = 'array'
  );
