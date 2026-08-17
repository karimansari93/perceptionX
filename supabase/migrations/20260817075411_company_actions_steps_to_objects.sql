-- steps: ["label", ...] -> [{"label": ..., "url": null}, ...]
--
-- Step-level receipts: a step like "respond in German to the Wellbeing threads"
-- needs the thread URL attached to that step, not floating in the action's
-- ai_reads. Applied to prod as `company_actions_steps_to_objects`.
--
-- Idempotent: only converts rows whose first element is still a string, so a
-- re-run skips already-converted rows. Element ORDER is preserved with
-- ORDINALITY because steps_done stores ticked positions as indices — reordering
-- would silently reassign an owner's ticks to different work.
--
-- jsonb_array_length is unchanged by the reshape, so set_company_action_steps()
-- (which only counts elements) needs no change. The renderer does: it reads
-- ->>'label' and links ->>'url'.

BEGIN;

UPDATE public.company_actions ca
SET steps = sub.new_steps
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

COMMENT ON COLUMN public.company_actions.steps IS
  'Authored checklist: [{"label": text, "url": text|null}]. Overwritten on re-import; completion lives in steps_done by index, so append rather than reorder.';

COMMIT;
