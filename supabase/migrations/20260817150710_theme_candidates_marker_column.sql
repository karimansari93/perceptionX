-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817150710; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- find_responses_missing_themes was reading tens of GB per call once the
-- backlog emptied: with zero candidates, its LIMIT never short-circuits, so
-- every poll walked ~90 days of responses probing ai_themes row by row
-- (315 calls today at 34s mean, 72 GB cumulative disk reads — the IO waves
-- behind today's dashboard 500s).
--
-- Fix: prompt_responses.themes_found_at marks rows that already have themes,
-- stamped by trigger at insert time and backfilled in bounded batches in the
-- statements following this migration. The candidate function and its partial
-- indexes then exclude processed rows structurally, so an empty poll touches
-- (almost) nothing.

alter table public.prompt_responses
  add column if not exists themes_found_at timestamptz;

-- Statement-level trigger: the classifier inserts many theme rows per
-- response in one statement, so stamp each parent once per statement.
create or replace function public.stamp_themes_found()
returns trigger language plpgsql as $$
begin
  update public.prompt_responses p
     set themes_found_at = now()
   where p.themes_found_at is null
     and p.id in (select distinct response_id from new_rows where response_id is not null);
  return null;
end $$;

drop trigger if exists ai_themes_stamp_found on public.ai_themes;
create trigger ai_themes_stamp_found
  after insert on public.ai_themes
  referencing new table as new_rows
  for each statement execute function public.stamp_themes_found();
