import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// One-off cleanup (approved by Karim 2026-10-14): deletes the 161 answers
// collected for 208 stray template prompts in the Netflix org on 2026-10-10
// (see migration 20261014120000). Only ids already copied into the
// backup_20261014_netflix_stray_* tables are touched; ai_themes and
// competitor_themes cascade from prompt_responses. Service role only.
// Safe to re-run (deletes nothing once the rows are gone). Remove after use.

// @ts-ignore Deno.env is available in edge runtime
const url = Deno.env.get("SUPABASE_URL") ?? "";
// @ts-ignore Deno.env is available in edge runtime
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, key);

async function ids(table: string): Promise<string[]> {
  const { data, error } = await db.from(table).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []).map((r: any) => r.id);
}

async function purge(table: string, column: string, values: string[]) {
  let n = 0;
  for (let i = 0; i < values.length; i += 100) {
    const { count, error } = await db.from(table).delete({ count: "exact" }).in(column, values.slice(i, i + 100));
    if (error) throw new Error(`${table}: ${error.message}`);
    n += count ?? 0;
  }
  return n;
}

serve(async (req) => {
  if (!key || req.headers.get("Authorization") !== `Bearer ${key}`) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  try {
    const responses = await ids("backup_20261014_netflix_stray_responses");
    const failures = await ids("backup_20261014_netflix_stray_failures");
    const result = {
      theme_batch_items: await purge("theme_batch_items", "response_id", responses),
      prompt_response_failures: await purge("prompt_response_failures", "id", failures),
      prompt_responses: await purge("prompt_responses", "id", responses),
    };
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500 });
  }
});
