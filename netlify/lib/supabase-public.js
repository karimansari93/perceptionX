// The Supabase URL and publishable anon key, as an edge-runtime fallback.
//
// Production edge functions report x-activate-preview: no-env — the runtime
// sees neither VITE_SUPABASE_URL nor the anon key under either of its names,
// even though the variables are configured in Netlify. Env vars there have
// scopes, and values marked secret are not exposed to Edge Functions at all;
// and because .env is a committed file the build never needed the Netlify
// copies, a wrong scope could sit unnoticed for years. These previews are the
// first thing that ever asked the edge runtime for them.
//
// Committing the values is safe ONLY because both are already public: they sit
// in the committed .env at the repo root and inside every JS bundle the site
// serves, and the anon key is a publishable key whose power is bounded by RLS
// and the SECURITY DEFINER RPCs. Never put a service-role key in this file.
//
// Real env vars still win when the runtime can see them — this is the floor,
// not the source of truth. Keep in sync with .env if the project ever moves.

export const SUPABASE_URL = 'https://ofyjvfmcgtntwamkubui.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meWp2Zm1jZ3RudHdhbWt1YnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwNzk1ODgsImV4cCI6MjA2MzY1NTU4OH0.vkzuvNTDMlAS77MHjNDBvBmm0tFGTSPIE7y_Ce3dy2k';
