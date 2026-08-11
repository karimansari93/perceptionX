-- Retire the stray index response on a retired-theme v1 prompt.
--
-- On 2026-08-04 12:22 UTC — ten minutes before the collect-industry-visibility
-- deploy that pinned prompt lookups to v2 rows by attribute_id — a gemini
-- collection for Hospitality / France resolved its prompt via the old
-- theme-only duplicate lookup and landed on the retired v1 prompt
-- ('Mission & Purpose', prompt_version 1, attribute_id null). The v2 prompt
-- ('Mission, Purpose & Impact') got its own full three-model collection ten
-- minutes later, so this row is redundant: it only adds a phantom
-- 'gemini::Mission & Purpose' combination to the France/Hospitality slice
-- (deflating every company's score there) and splits the theme rollup.
--
-- Retire it from the index rather than retag: moving it onto the v2 prompt
-- would create a duplicate gemini response for a prompt that already has one.

UPDATE prompt_responses pr
SET for_index = false
FROM confirmed_prompts cp
WHERE pr.confirmed_prompt_id = cp.id
  AND pr.for_index = true
  AND pr.ai_model = 'gemini'
  AND pr.tested_at >= '2026-08-01'
  AND cp.prompt_theme = 'Mission & Purpose'
  AND cp.prompt_version = 1;
