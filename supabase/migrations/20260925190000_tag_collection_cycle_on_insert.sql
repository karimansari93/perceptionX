-- Every new prompt_responses row gets a collection_cycle. Nothing in the
-- collection path writes it, so since early August most rows were untagged
-- and relied on response_month's created_at fallback.
--
-- A writer that knows the cycle (e.g. a run filling a past month) can still
-- pass it explicitly; otherwise the row is tagged with its UTC write month,
-- the same value response_month already falls back to, so no response_month
-- changes. Generated columns are computed after BEFORE triggers, so
-- response_month and the (prompt, model, response_month) unique index see
-- the tagged value.
CREATE OR REPLACE FUNCTION public.set_collection_cycle_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.collection_cycle IS NULL THEN
    NEW.collection_cycle :=
      date_trunc('month', COALESCE(NEW.created_at, now()) AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_collection_cycle ON public.prompt_responses;
CREATE TRIGGER trg_set_collection_cycle
  BEFORE INSERT ON public.prompt_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_collection_cycle_default();
