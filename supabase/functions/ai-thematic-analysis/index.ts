import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { queueForBatchTheming } from "../_shared/theme-queue.ts";

// Called fire-and-forget after a prompt_response is stored. Theming is
// batch-only, so this queues the response for theme-batch (half price,
// usually within the hour) instead of calling Claude.

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { response_id, company_name } = await req.json();
    if (!response_id) return json({ error: "response_id is required" }, 400);
    if (!company_name) return json({ error: "company_name is required" }, 400);

    const { queued, error } = await queueForBatchTheming(supabase, [response_id], company_name);
    if (error) return json({ error: "Failed to queue for batch theming", details: error }, 500);
    return json({ success: true, queued_for_batch: queued });
  } catch (error: any) {
    console.error("Error queueing theme analysis:", error);
    return json({ error: "Failed to queue theme analysis", details: error?.message ?? String(error) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
