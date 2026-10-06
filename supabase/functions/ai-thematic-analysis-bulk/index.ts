import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { queueForBatchTheming } from "../_shared/theme-queue.ts";

// Bulk entry point used by theme-backfill-tick, the theme gap fill and the
// admin panel. Theming is batch-only, so this queues the responses for
// theme-batch instead of calling Claude. Each result reports success: false
// with error "queued_for_batch" so callers never record a queued response as
// "no themes found".

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

interface ResponseData {
  response_id: string;
  response_text: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { responses, company_name } = await req.json();
    if (!Array.isArray(responses) || responses.length === 0) {
      return json({ error: "responses array is required and must not be empty" }, 400);
    }
    if (!company_name) return json({ error: "company_name is required" }, 400);

    const ids = responses.map((r: ResponseData) => r.response_id);
    const { queued, error } = await queueForBatchTheming(supabase, ids, company_name);
    if (error) return json({ error: "Failed to queue for batch theming", details: error }, 500);

    return json({
      success: true,
      summary: {
        total_responses: ids.length,
        queued_for_batch: queued,
        successful_responses: 0,
        failed_responses: 0,
        total_themes: 0,
        total_themes_created: 0,
      },
      results: ids.map((id: string) => ({ response_id: id, success: false, error: "queued_for_batch" })),
    });
  } catch (error: any) {
    console.error("Error queueing bulk theme analysis:", error);
    return json({ error: "Failed to queue themes", details: error?.message ?? String(error) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
