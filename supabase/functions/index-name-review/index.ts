import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isCreditExhausted } from "../_shared/claude-keys.ts";

// One-off review of company names from the new Index countries (Karim,
// 2026-10-18, approved at ~$0.30-0.50): size label, "is this an employer?" and
// "is it the same employer as an existing Index entry?" for every name that
// has no size label yet. Message Batches API on Claude Haiku (half price).
//
// Names are queued in index_name_review by queue_index_name_review(). A
// pg_cron tick calls this function every 5 minutes while work is open; each
// call 1) collects finished batches into the rows, 2) submits queued rows.
// Results are only stored here; applying them is a separate, reviewed step
// (see migration 20261018180000_index_name_review.sql).

const MODEL = "claude-haiku-5-5";
const NAMES_PER_REQUEST = 50;
// PostgREST returns at most 1000 rows per read, so one batch takes up to 1000
// names; the next tick submits the next 1000 once this batch is collected.
const NAMES_PER_BATCH = 1000;
const MAX_TOKENS = 2000;
const KEY_SLOTS = ["CLAUDE_API_KEY", "CLAUDE_API_KEY_NEXT"];
const API = "https://api.anthropic.com/v1/messages/batches";
const TIERS: Record<string, string> = {
  A: "<50", B: "50-499", C: "500-4999", D: "5000-49999", E: "50000+", U: "unknown",
};

const SYSTEM = `You check company names that AI assistants named as employers in employer-reputation answers. For each numbered name you get the countries and industries where it was named, and up to five candidate entries already on our list.

Answer every name with [n, size, employer, same]:
- size: global headcount of the whole company. A = under 50, B = 50-499, C = 500-4,999, D = 5,000-49,999, E = 50,000+, U = you do not know the company.
- employer: 1 if it is a real organisation that employs people (company, bank, hospital, university, government body), 0 if it is a category ("veterinary clinics"), a place, a product, app or game, a technology, a person or another term.
- same: the letter of the candidate that is the same employer under another name, spelling, abbreviation or country unit, otherwise "-". A parent group and a separately run company are not the same (TCS is not Tata, JLR is not Tata Motors, Merck KGaA is not Merck & Co.).

Reply with one JSON array of arrays and nothing else, for example [[1,"D",1,"a"],[2,"U",0,"-"]].`;

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// @ts-ignore Deno.env is available in edge runtime
const keyFor = (slot: string) => Deno.env.get(slot) ?? "";

const headersFor = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // This spends money: only the service role (the cron tick) may call it.
  if (jwtRole(req) !== "service_role") return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    const collected = await collect();
    const submitted = await submit(Number(body.maxRequests) || 0);
    return json({ collected, submitted });
  } catch (e: any) {
    console.error("[index-name-review]", e?.message ?? e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

// 1. Store the answers of ended batches.
async function collect() {
  const { data: batches } = await supabase
    .from("index_name_review_batches")
    .select("batch_id, key_slot")
    .eq("status", "submitted");
  let stored = 0;
  for (const b of batches ?? []) {
    const key = keyFor(b.key_slot);
    const res = await fetch(`${API}/${b.batch_id}`, { headers: headersFor(key) });
    const batch = await res.json();
    if (!res.ok) throw new Error(`batch ${b.batch_id}: ${res.status} ${JSON.stringify(batch)}`);
    if (batch.processing_status !== "ended") continue;

    const results = await fetch(batch.results_url, { headers: headersFor(key) });
    const lines = (await results.text()).split("\n").filter((l) => l.trim());
    const usage = { input_tokens: 0, output_tokens: 0 };
    const answers: Record<string, unknown>[] = [];
    const failed: Record<string, unknown>[] = [];
    for (const line of lines) {
      const r = JSON.parse(line);
      const msg = r.result?.type === "succeeded" ? r.result.message : null;
      usage.input_tokens += msg?.usage?.input_tokens ?? 0;
      usage.output_tokens += msg?.usage?.output_tokens ?? 0;
      const parsed = msg && msg.stop_reason === "end_turn" ? parseAnswers(msg) : new Map();
      for (const [pos, a] of parsed) answers.push({ custom_id: r.custom_id, request_pos: pos, ...a });
      if (parsed.size === 0) {
        failed.push({ custom_id: r.custom_id, error: msg ? `no answer (stop_reason ${msg.stop_reason})` : `batch result ${r.result?.type}` });
      }
    }
    const { data: n, error } = await supabase.rpc("index_name_review_store", {
      p_batch_id: b.batch_id, p_answers: answers, p_failed: failed, p_usage: usage,
    });
    if (error) throw new Error(`store ${b.batch_id}: ${error.message}`);
    stored += Number(n) || 0;
  }
  return stored;
}

// 2. Submit queued names (one open batch at a time).
async function submit(maxRequests: number) {
  const { count: open } = await supabase
    .from("index_name_review_batches")
    .select("batch_id", { count: "exact", head: true })
    .eq("status", "submitted");
  if (open) return 0;

  const limit = maxRequests > 0 ? Math.min(maxRequests * NAMES_PER_REQUEST, NAMES_PER_BATCH) : NAMES_PER_BATCH;
  const { data: rows } = await supabase
    .from("index_name_review")
    .select("name, countries, industries, candidates")
    .eq("status", "queued")
    .order("mentions", { ascending: false })
    .limit(limit);
  if (!rows || rows.length === 0) return 0;

  const stamp = Date.now().toString(36);
  const requests = [];
  const assigned: { name: string; custom_id: string; request_pos: number }[] = [];
  for (let i = 0; i < rows.length; i += NAMES_PER_REQUEST) {
    const chunk = rows.slice(i, i + NAMES_PER_REQUEST);
    const custom_id = `r${stamp}-${i / NAMES_PER_REQUEST}`;
    const lines = chunk.map((row, j) => {
      assigned.push({ name: row.name, custom_id, request_pos: j + 1 });
      const where = `seen in: ${(row.countries ?? []).join(", ")} (${(row.industries ?? []).slice(0, 3).join(", ")})`;
      const cands = (row.candidates ?? []).map((c: string, k: number) => `${"abcde"[k]}) ${c}`).join(" ");
      return `${j + 1}. ${row.name} | ${where} | candidates: ${cands || "none"}`;
    });
    requests.push({
      custom_id,
      params: {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system: SYSTEM,
        messages: [{ role: "user", content: lines.join("\n") }],
      },
    });
  }

  // Same key handover as claudeFetch, but the batch must be read back with
  // the key that created it, so the slot is recorded.
  let created: any = null;
  let slot = "";
  for (const s of KEY_SLOTS) {
    const key = keyFor(s);
    if (!key) continue;
    const res = await fetch(API, { method: "POST", headers: headersFor(key), body: JSON.stringify({ requests }) });
    const data = await res.json();
    if (res.ok) {
      created = data;
      slot = s;
      break;
    }
    if (!isCreditExhausted(data)) throw new Error(`create batch: ${res.status} ${JSON.stringify(data)}`);
  }
  if (!created) throw new Error("create batch: no key with credit");

  const { error } = await supabase.rpc("index_name_review_mark_submitted", {
    p_batch_id: created.id, p_key_slot: slot, p_requests: requests.length, p_rows: assigned,
  });
  if (error) throw new Error(`mark submitted ${created.id}: ${error.message}`);
  return assigned.length;
}

type Answer = { tier: string; employer: boolean; same: string | null };

/** [[n, size, employer, same], ...] -> answers by position; candidates resolved later in SQL. */
function parseAnswers(message: any): Map<number, Answer> {
  const text = (message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  const out = new Map<number, Answer>();
  if (start === -1 || end <= start) return out;
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  for (const row of Array.isArray(arr) ? arr : []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const [n, size, employer, same] = row;
    const tier = TIERS[String(size).toUpperCase()];
    if (!Number.isInteger(n) || !tier) continue;
    const letter = String(same).toLowerCase();
    out.set(n as number, {
      tier,
      employer: Number(employer) === 1,
      same: /^[a-e]$/.test(letter) ? letter : null,
    });
  }
  return out;
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
