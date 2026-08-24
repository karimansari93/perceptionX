-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260814120705; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Make the page actionable. Two additions:
--
-- 1. action_label — what the recipient would actually DO on this platform
--    ("Write a review", "Answer a question people are asking"). The card now
--    leads with this; the coverage stat drops to supporting evidence. Listing
--    a platform without naming the act left recipients asking "what do you
--    want me to do here?", which is a fair question and a dead link in
--    practice.
--
-- 2. is_listen_only — some sources are genuinely loud but have no appropriate
--    act for an employee. YouTube is mostly company and creator video;
--    Levels.fyi's only contribution is submitting your own salary, which is
--    off-thesis (comp, not experience) and not something this product should
--    ask anyone to do. These stop being action cards and become a short
--    "also read by AI" line, so we keep the truth without implying a task.
--
-- Verbs stay descriptive of the act, never of the sentiment: "Share what the
-- work looks like", never "share what you love about it".

alter table public.activate_routes
  add column if not exists action_label text,
  add column if not exists is_listen_only boolean not null default false;

update public.activate_routes r
set action_label = a.label
from (values
  ('glassdoor','Write a review'),
  ('indeed','Write a review'),
  ('kununu','Write a review'),
  ('ambitionbox','Write a review'),
  ('openwork','Write a review'),
  ('jobplanet','Write a review'),
  ('gowork','Write a review'),
  ('workventure','Write a review'),
  ('undelucram','Write a review'),
  ('profession','Write a review'),
  ('infojobs','Write a review'),
  ('seek','Write a review'),
  ('comparably','Rate your workplace'),
  ('jobtalk','Answer questions about working here'),
  ('reddit','Answer a question people are asking'),
  ('quora','Answer a question about working here'),
  ('blind','Post as a verified employee'),
  ('fourprogrammers','Reply in the thread about working here'),
  ('linkedin','Post about your work'),
  ('facebook','Post about your work'),
  ('instagram','Share what the work looks like'),
  ('tiktok','Show what the job is really like'),
  ('note','Write a post about your work'),
  ('naver','Write a blog post about your work'),
  ('brunch','Write a post about your work')
) as a(platform, label)
where r.platform = a.platform;

update public.activate_routes
set is_listen_only = true, action_label = null
where platform in ('youtube', 'levels');
