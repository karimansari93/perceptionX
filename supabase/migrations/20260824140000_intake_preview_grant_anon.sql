-- Restore the anon grant on the onboarding link-preview lookup.
--
-- The 20260706060000 migration granted execute to anon and authenticated, but
-- production denies anon (42501) — the function was evidently recreated at some
-- point without the grant coming along. Every social crawler fetching an
-- /onboarding/<token> preview hits this as the anon role, so invite previews
-- have been silently generic regardless of edge credentials.
grant execute on function public.intake_preview_by_token(text) to anon, authenticated;
