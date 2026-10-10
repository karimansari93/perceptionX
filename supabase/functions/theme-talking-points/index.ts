import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.65.0";

// Groups one company's theme names for one attribute into a handful of
// talking points ("what AI says about pay"). Theme names are ~90% unique
// per answer, so the raw list teaches a reader nothing; the talking points
// are what the attribute drilldown and reports show.
//
// Read-only: the caller sends the theme names (with counts) and gets back
// which talking point each name belongs to. Nothing is written here; shares
// and sentiment per talking point are computed by the caller from its own
// theme rows. Batch-only, like all theming (CLAUDE.md):
//   {action: "submit", company, topic, names: [{name, positive, neutral, negative}], runs?}
//     -> {batch_id}
//   {action: "fetch", batch_id}
//     -> {status, results: [{run, points: [{label, summary}], assignments: [pointIndex per name]}], usage}

const MODEL = "claude-haiku-5-5";

const SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          summary: { type: "string" },
        },
        required: ["label", "summary"],
        additionalProperties: false,
      },
    },
    // assignments[i] = position in points of the group label i belongs to.
    // One entry per label, in label order, so every label lands in exactly
    // one group (an earlier members-per-group shape left ~16% unassigned).
    assignments: { type: "array", items: { type: "integer" } },
  },
  required: ["points", "assignments"],
  additionalProperties: false,
};

const SYSTEM = `You group short theme labels into talking points.

The labels were extracted from AI assistant answers about an employer. Each label is one point an answer made about one topic (for example pay). Many labels say the same thing in different words.

Group them into 4 to 8 talking points that a recruiter would recognise as the distinct things AI says about the employer on this topic.

Rules:
- Group by what is claimed, not by wording. "Top-of-market compensation", "Excellent pay" and "High salaries" are one point.
- Keep a claim and its opposite apart: "pay is top of market" and "pay is below top tech rivals" are different points.
- A point that only a few labels make still gets its own group when it is a distinct claim a recruiter would care about (for example severance, or limited raises).
- assignments: one number per label, in the same order as the labels (label 0 first), giving the position (0-based) in points of the group it belongs to. Every label gets exactly one number. Write all of them.
- label: a plain-English statement of the claim, at most 8 words, no jargon, no em dashes. Write it as what AI says, e.g. "Pays top of market".
- summary: one sentence on what the answers in this group say.
- Order the groups from most labels to fewest.
- First decide the groups, then assign each label.`;

function buildRequest(company: string, topic: string, names: any[]) {
  const lines = names.map((n, i) =>
    `${i} | ${n.name} | +${n.positive ?? 0} =${n.neutral ?? 0} -${n.negative ?? 0}`
  ).join("\n");
  return {
    model: MODEL,
    max_tokens: 8000,
    // Haiku 5.5 rejects temperature and thinks by default; thinking is billed
    // as output, so it is off.
    thinking: { type: "disabled" },
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: `Employer: ${company}\nTopic: ${topic}\n\nLabels (index | label | how many answers made it positive / neutral / negative):\n${lines}`,
    }],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Spends Claude credit, so service role only (the anon key is a valid JWT).
  // @ts-ignore Deno.env is available in edge runtime
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return json({ error: "forbidden" }, 403);
  }
  try {
    // @ts-ignore Deno.env is available in edge runtime
    const client = new Anthropic({ apiKey: Deno.env.get("CLAUDE_API_KEY") ?? "" });
    const body = await req.json();

    if (body.action === "submit") {
      const names = Array.isArray(body.names) ? body.names : [];
      if (names.length === 0) return json({ error: "names is empty" }, 400);
      const runs = Math.min(Math.max(Number(body.runs) || 1, 1), 3);
      const params = buildRequest(String(body.company ?? ""), String(body.topic ?? ""), names);
      const batch = await client.messages.batches.create({
        requests: Array.from({ length: runs }, (_, i) => ({ custom_id: `run${i + 1}`, params: params as any })),
      });
      return json({ batch_id: batch.id, runs, names: names.length });
    }

    if (body.action === "fetch") {
      const batch = await client.messages.batches.retrieve(String(body.batch_id));
      if (batch.processing_status !== "ended") {
        return json({ status: batch.processing_status, counts: batch.request_counts });
      }
      const results: any[] = [];
      const usage = { input_tokens: 0, output_tokens: 0 };
      for await (const r of await client.messages.batches.results(batch.id)) {
        if (r.result.type !== "succeeded") {
          results.push({ run: r.custom_id, error: r.result.type });
          continue;
        }
        const msg: any = r.result.message;
        usage.input_tokens += msg.usage?.input_tokens ?? 0;
        usage.output_tokens += msg.usage?.output_tokens ?? 0;
        const text = msg.content.find((b: any) => b.type === "text")?.text ?? "";
        try {
          const parsed = JSON.parse(text);
          results.push({ run: r.custom_id, points: parsed.points, assignments: parsed.assignments, stop_reason: msg.stop_reason });
        } catch {
          results.push({ run: r.custom_id, error: "unparseable", stop_reason: msg.stop_reason });
        }
      }
      return json({ status: "ended", model: MODEL, usage, results });
    }

    return json({ error: "action must be submit or fetch" }, 400);
  } catch (e: any) {
    console.error("[theme-talking-points]", e?.message ?? e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
