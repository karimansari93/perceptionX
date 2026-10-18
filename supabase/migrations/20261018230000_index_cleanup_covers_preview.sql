-- The nightly name clean-up (sync_index_obvious_variants) also covers the
-- preview rankings with the 15 new countries, so the preview Karim checks is
-- as clean as the live Index will be after the switch-over.
--
-- index_visible_names: every name the public Index shows or will show. At the
-- switch-over the renamed views keep this view working (views follow the
-- object, not the name).

CREATE OR REPLACE VIEW public.index_visible_names AS
SELECT f, sum(m) AS m
FROM (
  SELECT canonical_name AS f, mention_count AS m FROM public.rankings_overview
  UNION ALL
  SELECT canonical_name, mention_count FROM public.rankings_historical
  UNION ALL
  SELECT canonical_name, mention_count FROM public.rankings_overview_v2
) x
GROUP BY f;
REVOKE ALL ON public.index_visible_names FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.index_country_suffix_plan()
RETURNS TABLE(fragment text, target text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH vis AS (
    SELECT f FROM index_visible_names
  ), visl AS (
    SELECT DISTINCT ON (lower(f)) lower(f) AS lf, f FROM vis ORDER BY lower(f), f
  ), s AS (
    SELECT f, lower(f) AS lf, strip_company_geo_legal_tail(f) AS rem FROM vis
  ), c AS (
    SELECT s.f, s.lf, coalesce(m.canonical_name, v.f) AS target
    FROM s
    LEFT JOIN company_canonical_names m ON m.variant_name = s.rem
    LEFT JOIN visl v ON v.lf = s.rem
    WHERE s.rem <> s.lf
      AND length(s.rem) >= 2
      AND s.rem !~ '\m(of|and|the|de|du|des|da|do|del|di|la|le|y|e)$'
      AND s.rem !~ '[&/+-]$'
      AND NOT EXISTS (SELECT 1 FROM company_keep_apart k WHERE lower(k.name) = s.lf)
      -- Generic words, and names that differ from the shorter entry
      -- ("Man Group" is not MAN, "News Corp" is not "News").
      AND s.rem NOT IN ('air', 'virgin', 'telecom', 'bank', 'banco', 'banque', 'national',
                        'royal', 'first', 'general', 'standard', 'united', 'grupo',
                        'credit', 'post', 'mobile', 'energy', 'power', 'airways', 'airlines',
                        'man', 'news', 'home', 'business', 'central', 'life', 'health',
                        'care', 'pet care', 'petcare', 'digital', 'capital', 'media',
                        'services', 'solutions', 'global', 'international', 'industries',
                        'systems', 'technologies', 'the', 'restaurant brands')
  ), direct AS (
    SELECT c.f, c.lf, t.f AS target
    FROM c
    JOIN visl t ON t.lf = lower(c.target)
    WHERE t.lf <> c.lf
  )
  -- One hop: if the parent is itself being folded, go straight to its parent.
  SELECT d.f, coalesce(p.target, d.target)
  FROM direct d
  LEFT JOIN direct p ON p.lf = lower(d.target) AND lower(p.target) <> d.lf;
$function$;

-- Which spelling wins: the company's own casing over the machine casing that
-- unmapped names get from initcap ("DB Cargo" over "Db Cargo", "Tecnológico
-- de Monterrey" over "Tecnológico De Monterrey"), then the more-mentioned
-- form ("Capgemini" over "Cap Gemini"), then more capitals. Names of three
-- letters or fewer fold only when they differ in capitals alone ("Bhp" ->
-- "BHP"); other short names are too likely to collide.
CREATE OR REPLACE FUNCTION public.index_spelling_variant_plan()
RETURNS TABLE(fragment text, target text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT f, m, regexp_replace(lower(unaccent(f)), '[\s.''’-]', '', 'g') AS k
    FROM index_visible_names
  ), ranked AS (
    SELECT f, k, first_value(f) OVER (
             PARTITION BY k
             ORDER BY (f <> initcap(f) OR f = upper(f)) DESC, m DESC,
                      length(regexp_replace(f, '[^[:upper:]]', '', 'g')) DESC, f) AS target
    FROM v
  )
  SELECT f, target FROM ranked
  WHERE f <> target AND (length(k) >= 4 OR lower(f) = lower(target));
$function$;

-- Separately run companies the country-suffix rule would otherwise fold.
INSERT INTO public.company_keep_apart (name, note) VALUES
  ('O2 Spain', 'Telefónica brand in Spain; O2 on the Index is the UK operator'),
  ('RTL Nederland', 'Owned by DPG Media since 2024, not RTL Group'),
  ('SoftBank Corp.', 'Telecom operator, separate from SoftBank Group'),
  ('Softbank Corp', 'Telecom operator, separate from SoftBank Group'),
  ('Sumitomo Corporation', 'Trading company, not the Sumitomo group'),
  ('Menzies LLP', 'UK accountancy firm, not Menzies Aviation'),
  ('Radio-Canada', 'Public broadcaster; the suffix rule would leave "Radio"')
ON CONFLICT (name) DO NOTHING;
