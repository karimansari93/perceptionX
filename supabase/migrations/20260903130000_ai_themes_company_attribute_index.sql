-- Index for attribute-scoped theme lookups (mcp_get_attribute_sources and
-- any "answers that carry a theme of attribute X for these companies" read).
--
-- Profiled on the Ford brand scope (18 profiles, 2026-09-03): the lookup
-- bitmap-scanned 127k ai_themes heap rows via idx_ai_themes_company_id and
-- discarded 116k on the attribute filter — 16.7k cold heap blocks, the bulk
-- of a 15 s query that the edge function's PostgREST connection cut off at
-- its 8 s statement budget. With this expression index the lookup is
-- index-only.
--
-- Built CONCURRENTLY by hand on production before this file landed (the
-- migration runner wraps files in a transaction, where CONCURRENTLY is not
-- allowed); IF NOT EXISTS makes this a no-op there and a plain build in
-- fresh environments.
CREATE INDEX IF NOT EXISTS idx_ai_themes_company_attr_resp
  ON public.ai_themes (company_id, (lower(btrim(attribute_id)))) INCLUDE (response_id);
