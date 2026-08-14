-- Client typography for the recipient page. Two families (heading + body),
-- each optionally backed by an uploaded font file.
--
-- Resolution on the page:
--   name + uploaded file -> @font-face registered under that family name
--   name only            -> treated as a Google Fonts family and linked
--   neither              -> the product defaults (Geologica / Plus Jakarta Sans)
--
-- Font files go in the same activate-branding bucket as logos and banners, so
-- index.html's CSP font-src had to gain the storage origin. The bucket's mime
-- allow-list gained the font types.
--
-- Uploading a licensed corporate font puts the file on a public URL — a
-- licensing question for the client, flagged in the admin UI.
alter table public.activate_branding
  add column if not exists heading_font text,
  add column if not exists body_font text,
  add column if not exists heading_font_url text,
  add column if not exists body_font_url text;

update storage.buckets
set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml','image/gif',
                               'font/woff2','font/woff','font/ttf','font/otf',
                               'application/font-woff','application/octet-stream']
where id = 'activate-branding';

-- activate_get_by_token gains the four font fields on the org payload; the
-- function body is otherwise unchanged from 20260813110000.
