-- Everything in the action register is live: a row is visible to its
-- organisation as soon as it is loaded, with no separate publish step
-- (Karim, 2026-10-26: "if its in the db we can see it"). Corrections are made
-- on the rows themselves.
--
-- RLS, the client RPCs, Ask AI and the quarterly email still read
-- published_at; giving it a default and filling the empty ones makes every
-- row pass those checks without changing any of them.
--
-- Effect when applied: Ford Motor Company's 27 register rows (loaded 2026-10-26)
-- become visible to Ford members. No other organisation has unpublished rows.

ALTER TABLE public.company_actions ALTER COLUMN published_at SET DEFAULT now();
ALTER TABLE public.client_report_snapshots ALTER COLUMN published_at SET DEFAULT now();

UPDATE public.company_actions SET published_at = now() WHERE published_at IS NULL;
UPDATE public.client_report_snapshots SET published_at = now() WHERE published_at IS NULL;
