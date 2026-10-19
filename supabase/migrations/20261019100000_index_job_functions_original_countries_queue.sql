-- Job-function answers for the 8 original Index countries (Karim, 2026-10-19:
-- "yes go ahead with $20"), so every country has job-function rankings. Same
-- 30 industries, 5 job functions each and 13 questions as the 15 new
-- countries, on the same three models: 15,600 questions, 46,800 answers.
-- Quoted at about $20, capped at $25.
--
-- One queue row per country x industry x job function, as in the October run
-- for the 15 new countries. process-visibility-queue works through them.
-- Guarded so a re-run does not queue the same slice twice.

INSERT INTO public.visibility_queue (config_id, industry, country, status, batch_index, total_prompts, job_function)
SELECT 'd426966c-5b9e-418e-a9c6-d77c9c69e7c2'::uuid, p.industry, c.code, 'pending', 0, 13, p.job_function
FROM (SELECT DISTINCT industry, job_function FROM public.index_prompts WHERE job_function IS NOT NULL) p
CROSS JOIN (VALUES ('BR'), ('CN'), ('FR'), ('DE'), ('IN'), ('AE'), ('GB'), ('US')) AS c(code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.visibility_queue q
  WHERE q.industry = p.industry AND q.country = c.code AND q.job_function = p.job_function
);
