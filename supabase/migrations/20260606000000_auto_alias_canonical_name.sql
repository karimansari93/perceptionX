-- =============================================================================
-- Auto-alias canonical names
--
-- Closes the dedupe gap that lets variants like "Apple" or "Amazon" re-appear
-- in the suggestion queue even after their canonical has been created.
--
-- Scenario before this fix:
--   1. Admin approves "Apple TV+" → canonical "Apple"  (only alias: "apple tv+")
--   2. Next cron run sees raw "Apple" in detected_competitors, normalizes to
--      "apple", looks up entity_aliases — no match — sends to LLM.
--   3. LLM says "map to existing canonical Apple" → suggestion created.
--   4. Same loop forever; the canonical's own name is never an alias of itself.
--
-- Fix: every canonical_entities and canonical_sources row gets an alias
-- pointing back at it with the canonical_name/domain_root. Implemented as a
-- trigger so future inserts stay covered, plus a one-time backfill for the
-- existing rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- entity_aliases self-alias
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_canonical_entity_self_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only act when the canonical is active and has a usable normalized name.
    IF NEW.is_active IS NOT TRUE OR NEW.normalized_name IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
    VALUES (NEW.id, NEW.canonical_name, NEW.normalized_name, 'auto_self', now())
    ON CONFLICT (normalized_alias) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_entities_self_alias ON public.canonical_entities;
CREATE TRIGGER canonical_entities_self_alias
    AFTER INSERT OR UPDATE OF canonical_name, normalized_name, is_active
    ON public.canonical_entities
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_canonical_entity_self_alias();


-- -----------------------------------------------------------------------------
-- source_aliases self-alias
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_canonical_source_self_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_active IS NOT TRUE OR NEW.normalized_domain_root IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.source_aliases (canonical_id, alias_domain, normalized_alias_domain, source, approved_at)
    VALUES (NEW.id, NEW.domain_root, NEW.normalized_domain_root, 'auto_self', now())
    ON CONFLICT (normalized_alias_domain) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_sources_self_alias ON public.canonical_sources;
CREATE TRIGGER canonical_sources_self_alias
    AFTER INSERT OR UPDATE OF canonical_name, normalized_domain_root, is_active
    ON public.canonical_sources
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_canonical_source_self_alias();


-- -----------------------------------------------------------------------------
-- One-time backfill — every existing canonical gets its self-alias
-- -----------------------------------------------------------------------------
INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
SELECT id, canonical_name, normalized_name, 'auto_self', now()
FROM public.canonical_entities
WHERE is_active IS TRUE
ON CONFLICT (normalized_alias) DO NOTHING;

INSERT INTO public.source_aliases (canonical_id, alias_domain, normalized_alias_domain, source, approved_at)
SELECT id, domain_root, normalized_domain_root, 'auto_self', now()
FROM public.canonical_sources
WHERE is_active IS TRUE
ON CONFLICT (normalized_alias_domain) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Bonus: resolve any orphan pending suggestions that now have a matching alias.
-- This is the same self-heal the edge function calls; running it inline here
-- means the long-tail of stale "Apple, Amazon" suggestions disappears the
-- moment this migration applies.
-- -----------------------------------------------------------------------------
SELECT public.resolve_orphan_canonicalization_suggestions();
