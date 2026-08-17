-- Storage for client-supplied Activate branding assets (company logo and
-- campaign banner), so marks are uploaded rather than looked up from logo.dev.
--
-- Public bucket on purpose: the recipient page is unauthenticated, so the
-- browser fetches these with no session and RLS can't help. Writes stay
-- admin-only, mirroring the existing custom-reports policies. 2 MB cap,
-- images only.
--
-- Verified after applying: admin upload 200; anonymous upload rejected with
-- "new row violates row-level security policy"; anonymous read of the public
-- URL 200 image/png; admin delete 200.
--
-- Objects are namespaced `{org_id}/{kind}-{timestamp}.{ext}` so replacing an
-- asset never collides with a cached copy of the previous one.
--
-- logo.dev remains the fallback when no logo has been uploaded, and still
-- serves the third-party platform marks (Glassdoor, Reddit, kununu, …), which
-- are not client assets and would be tedious to maintain by hand.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'activate-branding', 'activate-branding', true, 2097152,
  array['image/png','image/jpeg','image/webp','image/svg+xml','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "activate-branding public read" on storage.objects;
create policy "activate-branding public read" on storage.objects
  for select using (bucket_id = 'activate-branding');

drop policy if exists "activate-branding admin write" on storage.objects;
create policy "activate-branding admin write" on storage.objects
  for insert with check (bucket_id = 'activate-branding' and is_admin());

drop policy if exists "activate-branding admin update" on storage.objects;
create policy "activate-branding admin update" on storage.objects
  for update using (bucket_id = 'activate-branding' and is_admin());

drop policy if exists "activate-branding admin delete" on storage.objects;
create policy "activate-branding admin delete" on storage.objects
  for delete using (bucket_id = 'activate-branding' and is_admin());
