-- Industry questions for the 8 original Index countries on the same three
-- models as the 15 new countries (Karim, 2026-10-19: "and the $4"). 8
-- countries x 30 industries x 13 questions x 3 models = 9,360 answers.
--
-- Their public industry rankings keep reading the earlier collection
-- (index_country_status.overview_source = 'legacy'), so these answers do not
-- change what the site shows. They let profiles compare an overall rank and
-- job-function ranks measured the same way, and make switching those
-- countries one UPDATE if Karim decides to.
--
-- Same 30 industries as the job functions. Queued only after the gate in
-- 20261019120000 is live, and guarded against queuing a slice twice.

INSERT INTO public.visibility_queue (config_id, industry, country, status, batch_index, total_prompts, job_function)
SELECT 'd426966c-5b9e-418e-a9c6-d77c9c69e7c2'::uuid, i.industry, c.code, 'pending', 0, 13, NULL
FROM (SELECT DISTINCT industry FROM public.index_prompts WHERE job_function IS NOT NULL) i
CROSS JOIN (VALUES ('BR'), ('CN'), ('FR'), ('DE'), ('IN'), ('AE'), ('GB'), ('US')) AS c(code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.visibility_queue q
  WHERE q.industry = i.industry AND q.country = c.code AND q.job_function IS NULL
    AND q.created_at >= '2026-10-19'
);
