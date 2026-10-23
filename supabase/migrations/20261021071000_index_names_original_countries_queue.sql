-- Name review for the 8 original countries' new answers (Karim approved the
-- size labels on 2026-10-19 and "run it now" on 2026-10-21): 2,385 unlabelled
-- names that could reach a top 15 of a job function, or with two or more
-- mentions in the industry answers. About 1.5 cents on the Haiku batch.
-- Ran as a one-off pg_cron job with a 10 minute limit; the review batch then
-- runs through index-name-review-tick, unscheduled when it is done.

SELECT public.queue_index_name_review_job_functions(15);
SELECT public.queue_index_name_review(2);
