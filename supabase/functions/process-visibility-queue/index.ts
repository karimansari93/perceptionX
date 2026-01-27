import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Country mapping helper (Name -> Code)
    const COUNTRY_MAP: Record<string, string> = {
      "United States": "US",
      "United Kingdom": "GB",
      Canada: "CA",
      Australia: "AU",
      Germany: "DE",
      France: "FR",
      Italy: "IT",
      Spain: "ES",
      Netherlands: "NL",
      Sweden: "SE",
      Norway: "NO",
      Denmark: "DK",
      Finland: "FI",
      Switzerland: "CH",
      Austria: "AT",
      Belgium: "BE",
      Ireland: "IE",
      "New Zealand": "NZ",
      Singapore: "SG",
      Japan: "JP",
      "South Korea": "KR",
      China: "CN",
      India: "IN",
      Brazil: "BR",
      Mexico: "MX",
      Argentina: "AR",
      "South Africa": "ZA",
      "United Arab Emirates": "AE",
      "Saudi Arabia": "SA",
      "Global (All Countries)": "GLOBAL",
    };

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
              const countryCode = COUNTRY_MAP[ctry] || ctry;

              jobs.push({
                config_id: config.id,
                industry: ind,
                country: countryCode,
                status: "pending",
                batch_index: 0,
                total_prompts: 16, // Default
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

    // 2. PROCESSOR: Pick up pending jobs
    // We process a small amount to avoid timeouts.
    // This function should be called frequently (e.g. every minute).

    // Fetch one pending/processing job
    // Prioritize 'processing' to finish what started, then 'pending'
    const { data: jobs, error: jobError } = await supabase
      .from("visibility_queue")
      .select(
        `
        *,
        visibility_configurations!inner (
          user_id
        )
      `,
      )
      .in("status", ["pending", "processing"])
      .order("updated_at", { ascending: true }) // Oldest first
      .limit(1);

    if (jobError) throw jobError;

    let result = { processed: 0, message: "Idle" };

    if (jobs && jobs.length > 0) {
      const job = jobs[0];
      console.log(
        `[Processor] Processing Job ${job.id}: ${job.industry}/${job.country} (Batch ${job.batch_index})`,
      );

      // Mark as processing if pending
      if (job.status === "pending") {
        await supabase
          .from("visibility_queue")
          .update({ status: "processing", updated_at: now.toISOString() })
          .eq("id", job.id);
      }

      // Determine batch parameters
      // We process 1 prompt per execution to stay very safe within limits
      const BATCH_SIZE = 1;
      const currentOffset = job.batch_index;

      if (currentOffset >= job.total_prompts) {
        // Already done? Mark completed
        await supabase
          .from("visibility_queue")
          .update({ status: "completed", updated_at: now.toISOString() })
          .eq("id", job.id);
        result = {
          processed: 0,
          message: "Marked completed (was already done)",
        };
      } else {
        // Call the collection function
        try {
          // We invoke the other function directly via fetch
          // Note: In production, might be better to import logic, but fetch is easier for isolation
          console.log(`[Processor] Invoking collect-industry-visibility...`);

          const { data: invokeData, error: invokeError } =
            await supabase.functions.invoke("collect-industry-visibility", {
              body: {
                industry: job.industry,
                country: job.country,
                batchOffset: currentOffset,
                batchSize: BATCH_SIZE,
                skipResponses: false,
              },
            });

          if (invokeError) throw new Error(invokeError.message);
          if (!invokeData?.success)
            throw new Error(invokeData?.error || "Unknown error");

          // Success - update progress
          const nextOffset = currentOffset + BATCH_SIZE;
          const newStatus =
            nextOffset >= job.total_prompts ? "completed" : "processing";

          await supabase
            .from("visibility_queue")
            .update({
              batch_index: nextOffset,
              status: newStatus,
              updated_at: now.toISOString(),
              error_log: null, // Clear errors on success
            })
            .eq("id", job.id);

          result = {
            processed: 1,
            message: `Processed batch ${currentOffset} for Job ${job.id}`,
          };
          console.log(
            `[Processor] Success. New status: ${newStatus}, Next Offset: ${nextOffset}`,
          );

          // RECURSIVE CHAINING:
          // If we successfully processed a batch, and there's likely more work (either this job isn't done,
          // or other jobs exist), we trigger ourselves again immediately.
          // This allows the entire queue to drain with a single external Cron trigger (Hourly).

          if (newStatus === "processing") {
            console.log(`[Processor] Job not finished, chaining next batch...`);
            // Fire and forget - don't await to avoid holding this connection open
            fetch(`${supabaseUrl}/functions/v1/process-visibility-queue`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
            }).catch((e) => console.error("Failed to chain execution:", e));
          } else {
            // Job completed - check if there are MORE jobs pending
            const { count } = await supabase
              .from("visibility_queue")
              .select("*", { count: "exact", head: true })
              .eq("status", "pending");

            if (count && count > 0) {
              console.log(
                `[Processor] Job finished, but ${count} pending jobs remain. Chaining...`,
              );
              fetch(`${supabaseUrl}/functions/v1/process-visibility-queue`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json",
                },
              }).catch((e) => console.error("Failed to chain execution:", e));
            }
          }
        } catch (err: any) {
          console.error(`[Processor] Error processing job ${job.id}:`, err);

          // Increment retry or fail
          const retryCount = (job.retry_count || 0) + 1;
          const status = retryCount > 3 ? "failed" : "pending"; // Go back to pending to retry later

          await supabase
            .from("visibility_queue")
            .update({
              status: status,
              retry_count: retryCount,
              error_log: err.message,
              updated_at: now.toISOString(),
            })
            .eq("id", job.id);

          result = { processed: 0, message: `Error: ${err.message}` };
        }
      }
    }

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
