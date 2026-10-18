-- Applies the reviewed answers of the new-country name review
-- (20261018180000_index_name_review.sql).
--
-- Applied automatically:
--   - size labels (the same kind of AI label as the existing 40,000);
--   - the company's own spelling, only when it has the same letters as ours
--     ("Lg Cns" -> "LG CNS"; never a different name such as Statoil -> Equinor).
-- Applied only from the lists passed in, which are reviewed by hand (the
-- 500-name pilot showed the model's duplicate and non-employer calls are
-- often wrong):
--   - p_duplicates: names that join the existing Index entry the model chose;
--   - p_not_employers: names excluded from the Index.

CREATE OR REPLACE FUNCTION public.apply_index_name_review(
  p_duplicates text[] DEFAULT '{}', p_not_employers text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900000'
AS $function$
DECLARE
  r record;
  v_target text;
  v_respelled int := 0;
  v_labelled int := 0;
  v_merged int := 0;
  v_excluded int := 0;
BEGIN
  FOR r IN
    SELECT * FROM index_name_review_results WHERE status = 'stored'
  LOOP
    IF r.name = ANY (p_duplicates) AND r.same_as_entry IS NOT NULL THEN
      PERFORM index_fold_entry(r.name, r.same_as_entry, true);
      v_merged := v_merged + 1;
      CONTINUE;
    END IF;

    IF r.name = ANY (p_not_employers) THEN
      INSERT INTO company_overrides (canonical_name, status, exclusion_reason, notes)
      SELECT r.name, 'excluded', 'not_a_company', 'Not an employer (new-country name review, 2026-10-18)'
      WHERE NOT EXISTS (SELECT 1 FROM company_overrides o WHERE lower(o.canonical_name) = lower(r.name));
      v_excluded := v_excluded + 1;
      CONTINUE;
    END IF;

    v_target := r.name;
    IF r.display_name IS NOT NULL AND r.display_name <> r.name
       AND regexp_replace(lower(unaccent(r.display_name)), '[^a-z0-9]', '', 'g')
         = regexp_replace(lower(unaccent(r.name)), '[^a-z0-9]', '', 'g') THEN
      PERFORM index_fold_entry(r.name, r.display_name, true);
      v_target := r.display_name;
      v_respelled := v_respelled + 1;
    END IF;

    INSERT INTO company_employee_tiers (company_name, estimated_tier, confidence, classified_by, classified_at)
    SELECT v_target, r.tier, 'medium', 'llm', now()
    WHERE r.tier IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM company_employee_tiers t WHERE lower(t.company_name) = lower(v_target))
    ON CONFLICT (company_name) DO NOTHING;
    IF FOUND THEN
      v_labelled := v_labelled + 1;
    END IF;
  END LOOP;

  UPDATE index_name_review SET status = 'applied', updated_at = now() WHERE status = 'stored';

  RETURN jsonb_build_object('labelled', v_labelled, 'respelled', v_respelled,
                            'merged', v_merged, 'excluded', v_excluded);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_index_name_review(text[], text[]) FROM PUBLIC, anon, authenticated;
