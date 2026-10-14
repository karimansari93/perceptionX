import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { COUNTRY_NAME_TO_CODE } from "../_shared/countries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { forceConfigId } = await req.json().catch(() => ({}));

    const now = new Date();
    const currentDay = now.getUTCDate();
    const currentHour = now.getUTCHours();

    console.log(
      `[Scheduler] Checking for jobs at Day: ${currentDay}, Hour: ${currentHour} UTC`,
    );

    let configs = [];

    if (forceConfigId) {
      console.log(
        `[Scheduler] FORCE RUN requested for config: ${forceConfigId}`,
      );
      const { data, error } = await supabase
        .from("visibility_configurations")
        .select("*")
        .eq("id", forceConfigId);

      if (error) throw error;
      configs = data || [];
    } else {
      // 1. SCHEDULER: Check for active configurations due to run
      // We verify if last_run_at is NOT in the current month to avoid duplicate runs
      const { data, error } = await supabase
        .from("visibility_configurations")
        .select("*")
        .eq("is_active", true)
        .eq("schedule_day", currentDay)
        .eq("schedule_hour", currentHour);

      if (error) throw error;
      configs = data || [];
    }

    // Country mapping imported from _shared/countries.ts (COUNTRY_NAME_TO_CODE)

    if (configs && configs.length > 0) {
      console.log(`[Scheduler] Found ${configs.length} configs to trigger.`);

      for (const config of configs) {
        // Check if already run this month (Skip check if FORCE RUN)
        const lastRun = config.last_run_at
          ? new Date(config.last_run_at)
          : null;
        const isRunThisMonth =
          lastRun &&
          lastRun.getMonth() === now.getMonth() &&
          lastRun.getFullYear() === now.getFullYear();

        if (!isRunThisMonth || forceConfigId) {
          console.log(`[Scheduler] Creating jobs for User ${config.user_id}`);

          const industries = config.target_industries || [];
          const countries = config.target_countries || [];

          if (industries.length === 0 || countries.length === 0) {
            console.log(
              `[Scheduler] Config ${config.id} has empty lists, skipping.`,
            );
            continue;
          }

          const jobs = [];
          for (const ind of industries) {
            for (const ctry of countries) {
              // Convert Full Name to Code if possible, otherwise keep as is
              const countryCode = COUNTRY_NAME_TO_CODE[ctry] || ctry;

              jobs.push({
                config_id: config.id,
                industry: ind,
                country: countryCode,
                status: "pending",
                batch_index: 0,
                total_prompts: 13, // v2 discovery set (DISCOVERY_PROMPTS)
              });
            }
          }

          if (jobs.length > 0) {
            const { error: insertError } = await supabase
              .from("visibility_queue")
              .insert(jobs);

            if (insertError) {
              console.error(
                `[Scheduler] Failed to insert jobs for config ${config.id}:`,
                insertError,
              );
            } else {
              // Update last_run_at
              await supabase
                .from("visibility_configurations")
                .update({ last_run_at: now.toISOString() })
                .eq("id", config.id);

              console.log(
                `[Scheduler] Successfully queued ${jobs.length} jobs for config ${config.id}`,
              );
            }
          }
        } else {
          console.log(
            `[Scheduler] Config ${config.id} already ran this month.`,
          );
        }
      }
    }

    // 2. PROCESSOR: work through the queue for up to PROCESS_BUDGET_MS.
    // A pg_cron job (visibility-queue-processor) calls this every minute while
    // collection is active, so there is no self-chaining: a run that dies is
    // simply replaced by the next minute's run. The budget stays well under a
    // minute so consecutive runs don't overlap and collect the same prompt.
    const PROCESS_BUDGET_MS = 45_000;
    const BATCH_SIZE = 1; // prompts per collector call (3 models in parallel)
    const startedAt = Date.now();
    let processed = 0;
    let lastMessage = "Idle";

    while (Date.now() - startedAt < PROCESS_BUDGET_MS) {
      // Oldest-touched live job first, so jobs advance round-robin.
      const { data: jobs, error: jobError } = await supabase
        .from("visibility_queue")
        .select("*")
        .in("status", ["pending", "processing"])
        .or("is_cancelled.is.null,is_cancelled.eq.false")
        .order("updated_at", { ascending: true })
        .limit(1);

      if (jobError) throw jobError;
      if (!jobs || jobs.length === 0) break;

      const job = jobs[0];
      const nowIso = new Date().toISOString();

      if (job.batch_index >= job.total_prompts) {
        await supabase
          .from("visibility_queue")
          .update({ status: "completed", updated_at: nowIso })
          .eq("id", job.id);
        continue;
      }

      console.log(
        `[Processor] Job ${job.id}: ${job.industry}/${job.country}${job.job_function ? `/${job.job_function}` : ""} (batch ${job.batch_index})`,
      );

      try {
        const { data: invokeData, error: invokeError } =
          await supabase.functions.invoke("collect-industry-visibility", {
            body: {
              industry: job.industry,
              country: job.country,
              batchOffset: job.batch_index,
              batchSize: BATCH_SIZE,
              skipResponses: false,
              jobFunction: job.job_function ?? null,
              // null = the collector's default model set
              models: job.models ?? null,
            },
          });

        if (invokeError) throw new Error(invokeError.message);
        if (!invokeData?.success)
          throw new Error(invokeData?.error || "Unknown error");

        const nextOffset = job.batch_index + BATCH_SIZE;
        await supabase
          .from("visibility_queue")
          .update({
            batch_index: nextOffset,
            status: nextOffset >= job.total_prompts ? "completed" : "processing",
            updated_at: new Date().toISOString(),
            error_log: null,
          })
          .eq("id", job.id);

        processed++;
        lastMessage = `Processed batch ${job.batch_index} for job ${job.id}`;
      } catch (err: any) {
        console.error(`[Processor] Error processing job ${job.id}:`, err);
        const retryCount = (job.retry_count || 0) + 1;
        await supabase
          .from("visibility_queue")
          .update({
            // Back to pending (end of the line) until retries run out.
            status: retryCount > 3 ? "failed" : "pending",
            retry_count: retryCount,
            error_log: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        lastMessage = `Error: ${err.message}`;
      }
    }

    const result = { processed, message: lastMessage };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
