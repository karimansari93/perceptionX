-- Thermo Fisher Scientific Amplify branding: brand red and Orient teal.
--
-- Colours are from public brand sources (Brandfetch), not Thermo Fisher's own
-- guide; confirm against it. Font and hero photo are still to come.
--
-- Previous values, for rollback (2026-10-12):
--   primary_color #13274F, accent_color #DB5E89 (the PerceptionX defaults)

update public.activate_branding
set primary_color = '#EE3134',
    accent_color = '#01667E',
    updated_at = now()
where org_id = '11ce6833-abe0-496b-8ffb-544a6e0cacc1';
