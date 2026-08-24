-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817075411; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- steps: ["label", ...] -> [{"label": ..., "url": null}, ...]  (idempotent)
UPDATE public.company_actions ca
SET steps = sub.new_steps, updated_at = now()
FROM (
  SELECT id,
         (SELECT jsonb_agg(jsonb_build_object('label', s.value, 'url', NULL) ORDER BY s.ord)
          FROM jsonb_array_elements_text(steps) WITH ORDINALITY AS s(value, ord)) AS new_steps
  FROM public.company_actions
  WHERE steps IS NOT NULL
    AND jsonb_typeof(steps) = 'array'
    AND jsonb_array_length(steps) > 0
    AND jsonb_typeof(steps->0) = 'string'
) sub
WHERE ca.id = sub.id;
