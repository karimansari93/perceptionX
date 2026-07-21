# Public Site (evi-px) — Shared-DB Dependencies

Two codebases run migrations against the one Supabase project
(`ofyjvfmcgtntwamkubui`): this repo (the authenticated perceptionX dashboard)
and `karimansari93/evi-px` (the public site at employers.perceptionx.ai).
The public site reads the DB **anonymously** (anon key over PostgREST), so
grants this repo's migrations touch are load-bearing for an app whose code
never appears in this repo's greps.

**Any security-hardening pass run from this repo MUST preserve the access
listed below.** This has broken three times, always the same way — a lockdown
migration here revoked anon SELECT, and every request from the public site
started failing with 401:

| Broken by | Restored by |
|---|---|
| `20260218070242_revoke_mv_api_access` | `20260219142612_fix_rankings_view_permissions` |
| `20260707162411_lock_down_function_and_mv_exposure` | `20260711071724_restore_public_index_grants`, `20260711071919_restore_index_rpc_grants` |
| `20260720085728_lock_down_public_materialized_views` | `20260721000000_restore_public_index_anon_grants` |

## Must stay anon-readable (public by design)

Materialized views — these cannot carry RLS, so anon table-level SELECT is
the *only* access control, and Supabase's security advisor will forever flag
them as "materialized view exposed in API". For these three, that lint is an
**accepted trade-off**: they contain only published aggregate rankings data.
Do not "fix" the lint by revoking anon.

- `public.rankings_overview`
- `public.rankings_historical`
- `public.company_search_index`

Each carries a `COMMENT ON` marker starting with `PUBLIC BY DESIGN` so sweeps
that inspect objects directly see the warning in place.

## Must stay anon-executable

SECURITY INVOKER RPCs the public site calls — these also depend on the
matview grants above, since they read the matviews as `anon`:

- `get_canonical_name_from_slug(text)`
- `get_rankings(...)` / `get_rankings_with_change(text, text, text)`
- `get_company_trend(text, text, text, text, integer)`
- `get_company_subsidiaries(text)`
- `get_available_periods(text)`
- `get_active_industries()`
- `search_companies(text, integer)`

SECURITY DEFINER API layer (`api_company`, `api_compare`, `api_rankings`,
`api_search`, `api_resolve_slug`, `api_meta`, `api_last_refreshed`,
`api_db_country`) — used by the public site's `/api` edge function. These
survive grant revocations on the underlying matviews, but must keep anon
EXECUTE themselves.

## What this does NOT mean

`anon` also holds table-level SELECT on many regular tables (`profiles`,
`organizations`, `prompt_responses`, ...). Those are RLS-gated — the grant is
the standard Supabase posture and the policies deny rows. Tightening those is
fine and is not covered by this document. Only the objects listed above are
consumed anonymously by the public site.

## Checklist for future hardening passes

1. Before revoking anything from `anon`, check the object for a
   `PUBLIC BY DESIGN` comment (`\dm+` / `obj_description`).
2. Grep **both repos** — this one and `evi-px` — for the object name.
3. Treat the advisor's "materialized view in API" finding on the three
   matviews above as accepted; if the lint must go quiet, the route is moving
   the public site's reads behind SECURITY DEFINER RPCs (like the `api_*`
   layer), coordinated with evi-px — never a bare revoke.
