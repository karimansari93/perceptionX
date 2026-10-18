-- Follow-ups to the company list clean-up (20261018160000).
--
-- 1. "Reliance" had no size label ("reliance" is labelled unknown), so
--    Reliance Industries never showed on the Index. It becomes Reliance
--    Industries, which is labelled. Anil Ambani's Reliance companies (a
--    different group) sat in the same entry and get their own.
-- 2. The spelling pass picked the most-mentioned spelling even when that was
--    a machine-capitalised one ("Db Cargo" over "DB Cargo", "Hewlett-packard"
--    over "Hewlett-Packard"). It now prefers the spelling with more capital
--    letters, then the most mentions.

SELECT public.index_split_variants(s.p, s.rx, s.t) FROM (VALUES
  (0, 'Reliance', '^reliance general insurance', 'Reliance General Insurance'),
  (1, 'Reliance', '^reliance nippon life', 'Reliance Nippon Life Insurance'),
  (2, 'Reliance', '^reliance defence', 'Reliance Defence and Aerospace'),
  (3, 'Reliance', '^reliance entertainment', 'Reliance Entertainment'),
  (4, 'Reliance', '^reliance games', 'Reliance Games'),
  (5, 'Reliance', '^reliance group$', 'Reliance Group'),
  (6, 'Reliance', '^reliance life sciences', 'Reliance Life Sciences')
) AS s(ord, p, rx, t) ORDER BY s.ord;

SELECT public.index_fold_entry('Reliance', 'Reliance Industries', true);

INSERT INTO public.company_keep_apart (name, note) VALUES
  ('Reliance Industries', 'Separate employer (2026-10-18 clean-up)'),
  ('Reliance General Insurance', 'Anil Ambani group, not Reliance Industries'),
  ('Reliance Nippon Life Insurance', 'Anil Ambani group, not Reliance Industries'),
  ('Reliance Group', 'Anil Ambani group, not Reliance Industries'),
  ('Reliance Defence and Aerospace', 'Anil Ambani group, not Reliance Industries'),
  ('Reliance Entertainment', 'Anil Ambani group, not Reliance Industries'),
  ('Reliance Games', 'Anil Ambani group, not Reliance Industries'),
  ('Reliance Life Sciences', 'Separate company, not Reliance Industries')
ON CONFLICT (name) DO NOTHING;

-- The first nightly run after the split folded this one back (it was not on
-- the keep-apart list yet).
SELECT public.index_split_variants('Reliance Industries', '^reliance entertainment', 'Reliance Entertainment');

CREATE OR REPLACE FUNCTION public.index_spelling_variant_plan()
RETURNS TABLE(fragment text, target text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH vis AS (
    SELECT canonical_name AS f, sum(mention_count) AS m FROM rankings_overview GROUP BY 1
    UNION ALL
    SELECT canonical_name, sum(mention_count) FROM rankings_historical GROUP BY 1
  ), v AS (
    SELECT f, sum(m) AS m, regexp_replace(lower(unaccent(f)), '[\s.''’-]', '', 'g') AS k
    FROM vis
    GROUP BY f
  ), ranked AS (
    SELECT f, first_value(f) OVER (PARTITION BY k ORDER BY length(regexp_replace(f, '[^[:upper:]]', '', 'g')) DESC, m DESC, f) AS target
    FROM v
    WHERE length(k) >= 4
  )
  SELECT f, target FROM ranked WHERE f <> target;
$function$;

REVOKE EXECUTE ON FUNCTION public.index_spelling_variant_plan() FROM PUBLIC, anon, authenticated;
