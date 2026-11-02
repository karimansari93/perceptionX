import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { filterCompetitorNames } from "../_shared/competitor-prompt.ts";

// One-off backfill of prompt_responses.detected_competitors (Rodrigo,
// 2026-11-02). detect-competitors called OpenAI gpt-4.1-nano until OpenAI
// retired it on 2026-10-23; every answer collected after that was saved with
// detected_competitors null (null = detection failed, '' = none found). #220
// moved detect-competitors to Claude Haiku 5.5.
//
// Each in-scope row goes through the live detect-competitors function, so the
// prompts and model are exactly what new answers get, then through the same
// name filter analyze-response applies before it stores the list. Only rows
// that are still null are touched, so a re-run picks up where it stopped and
// a failed call simply stays null for the next run.
//
// Body:
//   organizationId  required; scope is that org's companies
//   dates           required; UTC days of tested_at, e.g. ["2026-10-23"]
//   dryRun          true: count rows and size only, no AI calls, no writes
//   limit           rows per chunk (default 150)
//   chain           true: start the next chunk when this one is done
//   stopAt          ISO time; no new chunk starts after it (required to chain)
//
// Chaining also stops when no rows are left, or when more than a fifth of a
// chunk's calls fail (out of credit, rate limits), so a broken run never
// keeps spending.

const DEFAULT_LIMIT = 150;
const CONCURRENCY = 8;
// Stop starting new calls well before the edge wall-clock limit.
const TIME_BUDGET_MS = 100_000;
const MAX_FAILURE_SHARE = 0.2;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceKey);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // This spends money and writes rows: only the service role may call it.
  if (jwtRole(req) !== "service_role") return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const organizationId: string = body.organizationId;
  const dates: string[] = Array.isArray(body.dates) ? body.dates : [];
  if (!organizationId || dates.length === 0 || !dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    return json({ error: "organizationId and dates (YYYY-MM-DD) are required" }, 400);
  }
  if (body.chain && !body.stopAt) return json({ error: "stopAt is required to chain" }, 400);

  try {
    const companies = await orgCompanies(organizationId);
    if (companies.length === 0) return json({ error: "no companies for this organization" }, 404);

    if (body.dryRun) return json(await dryRun(companies, dates));

    const result = await runChunk(companies, dates, Number(body.limit) || DEFAULT_LIMIT);
    const remaining = await countRemaining(companies, dates);
    const tooManyFailures = result.attempted > 0 && result.failed / result.attempted > MAX_FAILURE_SHARE;
    const beforeStop = body.stopAt ? Date.now() < Date.parse(body.stopAt) : false;
    const chained = Boolean(body.chain) && remaining > 0 && !tooManyFailures && beforeStop;

    console.log(
      `[backfill-competitors] chunk: attempted=${result.attempted} filled=${result.filled} ` +
        `empty=${result.empty} failed=${result.failed} remaining=${remaining} chained=${chained}` +
        (tooManyFailures ? " STOPPED: too many failures" : "") +
        (body.chain && !beforeStop ? " STOPPED: past stopAt" : ""),
    );

    if (chained) {
      const next = fetch(`${supabaseUrl}/functions/v1/backfill-competitors`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch((e) => console.error("[backfill-competitors] chain failed:", e));
      try {
        // @ts-ignore EdgeRuntime is provided by the Supabase Deno runtime
        (globalThis as any).EdgeRuntime?.waitUntil(next);
      } catch {
        // Not available locally; the fetch above is already in flight.
      }
    }

    return json({ ...result, remaining, chained, stoppedForFailures: tooManyFailures });
  } catch (e: any) {
    console.error("[backfill-competitors]", e?.message ?? e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

async function orgCompanies(organizationId: string) {
  const { data, error } = await supabase
    .from("organization_companies")
    .select("company_id, companies!inner(name)")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`companies: ${error.message}`);
  return (data ?? []).map((r: any) => ({ id: r.company_id as string, name: r.companies.name as string }));
}

// One UTC day of tested_at per date; uses the (company_id, tested_at, id) index.
function scoped(columns: string, companyId: string, date: string, head = false) {
  const end = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
  return supabase
    .from("prompt_responses")
    .select(columns, head ? { count: "exact", head: true } : undefined)
    .eq("company_id", companyId)
    .gte("tested_at", `${date}T00:00:00Z`)
    .lt("tested_at", end)
    .is("detected_competitors", null);
}

async function countRemaining(companies: { id: string }[], dates: string[]) {
  let total = 0;
  for (const c of companies) {
    for (const d of dates) {
      const { count, error } = await scoped("id", c.id, d, true);
      if (error) throw new Error(`count: ${error.message}`);
      total += count ?? 0;
    }
  }
  return total;
}

async function dryRun(companies: { id: string; name: string }[], dates: string[]) {
  const perCompany = [];
  for (const c of companies) {
    const perDate: Record<string, number> = {};
    for (const d of dates) {
      const { count, error } = await scoped("id", c.id, d, true);
      if (error) throw new Error(`count: ${error.message}`);
      perDate[d] = count ?? 0;
    }
    perCompany.push({ company: c.name, perDate, total: Object.values(perDate).reduce((a, b) => a + b, 0) });
  }
  return { dryRun: true, perCompany, total: perCompany.reduce((a, c) => a + c.total, 0) };
}

async function runChunk(companies: { id: string; name: string }[], dates: string[], limit: number) {
  // Fill the chunk company by company, date by date.
  const rows: { id: string; text: string; company: string }[] = [];
  for (const c of companies) {
    for (const d of dates) {
      if (rows.length >= limit) break;
      const { data, error } = await scoped("id, response_text", c.id, d)
        .order("id", { ascending: true })
        .limit(limit - rows.length);
      if (error) throw new Error(`rows: ${error.message}`);
      for (const r of (data ?? []) as any[]) rows.push({ id: r.id, text: r.response_text ?? "", company: c.name });
    }
  }

  const started = Date.now();
  const result = { attempted: 0, filled: 0, empty: 0, failed: 0, skippedForTime: 0 };
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      if (Date.now() - started > TIME_BUDGET_MS) {
        result.skippedForTime++;
        continue;
      }
      if (!row.text.trim()) continue;
      result.attempted++;
      const names = await detect(row.text, row.company);
      if (names === null) {
        result.failed++;
        continue;
      }
      const { error } = await supabase
        .from("prompt_responses")
        .update({ detected_competitors: names })
        .eq("id", row.id)
        .is("detected_competitors", null);
      if (error) {
        console.error(`[backfill-competitors] update ${row.id}: ${error.message}`);
        result.failed++;
      } else if (names) {
        result.filled++;
      } else {
        result.empty++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}

// null = detection failed (row stays null); '' = ran, no competitors.
async function detect(text: string, companyName: string): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/detect-competitors`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ response: text, companyName }),
    });
    if (!res.ok) {
      console.error(`[backfill-competitors] detect-competitors ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    return filterCompetitorNames((data.detectedCompetitors || "") as string, companyName);
  } catch (e) {
    console.error("[backfill-competitors] detect-competitors failed:", e);
    return null;
  }
}

function jwtRole(req: Request): string | null {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
