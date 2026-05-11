import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// One tick = up to MAX_BATCHES_PER_TICK batches of BATCH_SIZE URLs. Tunable
// to balance Firecrawl spend / rate limits against throughput. With the cron
// firing every minute and self-chain at the end, raising these only matters
// if Firecrawl can keep up.
const BATCH_SIZE = 50;
const MAX_BATCHES_PER_TICK = 4;
// A job is considered "stalled" if its updated_at hasn't moved in this long
// — at that point another worker is allowed to take over. Has to be longer
// than the worst-case batch time (extract-recency-scores can run ~90s on a
// bad day) to avoid preempting a healthy worker mid-batch.
const STALE_LEASE_MS = 180_000;

interface JobRow {
  id: string;
  organization_id: string;
  status: string;
  total: number;
  processed: number;
  is_cancelled: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // -----------------------------------------------------------------------
    // Pick & atomically claim the oldest active job.
    //
    // Multiple ticks can fire simultaneously (UI bootstrap + cron + self-chain
    // retries). Without a lease they all claim the same job and process the
    // same URLs in parallel — that's what caused job 9f486166 to overshoot
    // processed by 25k and hammer the DB. The claim below only succeeds if
    // the row is either 'queued' OR 'running' with a stale heartbeat. Other
    // ticks get null and exit.
    // -----------------------------------------------------------------------
    const { data: candidate, error: pickErr } = await supabase
      .from("recency_rescore_jobs")
      .select("id")
      .in("status", ["queued", "running"])
      .eq("is_cancelled", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) {
      console.error("[RecencyRescore] Failed to pick job:", pickErr);
      return jsonResponse({ error: pickErr.message }, 500);
    }

    if (!candidate) {
      return jsonResponse({ message: "No active jobs" }, 200);
    }

    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_LEASE_MS).toISOString();

    const { data: claimedRows, error: claimErr } = await supabase
      .from("recency_rescore_jobs")
      .update({ status: "running", updated_at: now.toISOString() })
      .eq("id", candidate.id)
      .eq("is_cancelled", false)
      .or(`status.eq.queued,and(status.eq.running,updated_at.lt.${staleCutoff})`)
      .select("id, organization_id, status, total, processed, is_cancelled");

    if (claimErr) {
      console.error(`[RecencyRescore] Failed to claim job ${candidate.id}:`, claimErr);
      return jsonResponse({ error: claimErr.message }, 500);
    }

    if (!claimedRows || claimedRows.length === 0) {
      // Another worker holds the lease — exit cleanly. They'll keep working
      // and chain themselves; if they die, the cron picks up the slack via
      // the stale-lease branch above.
      return jsonResponse({ skipped: "lease held by another worker" }, 200);
    }

    const job = claimedRows[0] as JobRow;
    console.log(`[RecencyRescore] Claimed job ${job.id} for org ${job.organization_id}, processed=${job.processed}/${job.total}`);

    // -----------------------------------------------------------------------
    // Process up to MAX_BATCHES_PER_TICK batches.
    // -----------------------------------------------------------------------
    let totalProcessedThisTick = 0;
    let drained = false;
    let batchError: string | null = null;

    for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
      // Re-check cancellation on every iteration so the user can stop fast.
      const { data: fresh } = await supabase
        .from("recency_rescore_jobs")
        .select("is_cancelled, status")
        .eq("id", job.id)
        .single();

      if (fresh?.is_cancelled || fresh?.status === "cancelled") {
        console.log(`[RecencyRescore] Job ${job.id} cancelled by user, stopping.`);
        return jsonResponse({ cancelled: true, processedThisTick: totalProcessedThisTick }, 200);
      }

      // Pull the next batch of URLs that have never been scored.
      const { data: urls, error: urlsErr } = await supabase
        .from("v_organization_url_status")
        .select("url")
        .eq("organization_id", job.organization_id)
        .is("extraction_method", null)
        .limit(BATCH_SIZE);

      if (urlsErr) {
        console.error(`[RecencyRescore] Failed to fetch URLs for job ${job.id}:`, urlsErr);
        batchError = urlsErr.message;
        break;
      }

      if (!urls || urls.length === 0) {
        drained = true;
        break;
      }

      const { error: invokeErr } = await supabase.functions.invoke("extract-recency-scores", {
        body: { citations: urls.map((u: { url: string }) => ({ url: u.url })) },
      });

      if (invokeErr) {
        console.error(`[RecencyRescore] extract-recency-scores failed for job ${job.id}:`, invokeErr);
        batchError = invokeErr.message ?? String(invokeErr);
        break;
      }

      totalProcessedThisTick += urls.length;

      // Truthful progress: count what's actually been scored, not what we
      // optimistically fired off. Capped at total so the bar can't overshoot
      // when total drifts (orgs can pick up new citation URLs over time).
      const { count: missingCount } = await supabase
        .from("v_organization_url_status")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", job.organization_id)
        .is("extraction_method", null);

      const realProcessed = Math.min(
        job.total,
        Math.max(0, job.total - (missingCount ?? 0)),
      );

      const { error: progressErr } = await supabase
        .from("recency_rescore_jobs")
        .update({
          processed: realProcessed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (progressErr) {
        console.error(`[RecencyRescore] Failed to update progress for job ${job.id}:`, progressErr);
      }
    }

    // -----------------------------------------------------------------------
    // Terminal handling.
    // -----------------------------------------------------------------------
    if (drained) {
      await supabase
        .from("recency_rescore_jobs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // Slack alert via the existing helper.
      await supabase.rpc("send_batch_alert", {
        payload: {
          event: "recency_rescore_done",
          text: `Recency rescore for org \`${job.organization_id}\` completed. ${job.total} URLs processed.`,
          fields: [
            { label: "Job", value: job.id },
            { label: "Org", value: job.organization_id },
            { label: "Total", value: String(job.total) },
          ],
        },
      });

      return jsonResponse({
        done: true,
        processedThisTick: totalProcessedThisTick,
      }, 200);
    }

    if (batchError) {
      // Soft-fail: leave the job running so the next cron tick retries.
      // Persist the last error message for observability.
      await supabase
        .from("recency_rescore_jobs")
        .update({
          last_error: batchError,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return jsonResponse({
        error: batchError,
        processedThisTick: totalProcessedThisTick,
      }, 200);
    }

    // Still work to do — self-chain to keep the worker hot, otherwise we'd
    // wait for the next cron tick (up to 60s of idle time).
    chainSelf(supabaseUrl, supabaseKey).catch((e) =>
      console.error("[RecencyRescore] Failed to self-chain:", e),
    );

    return jsonResponse({
      processedThisTick: totalProcessedThisTick,
      chained: true,
    }, 200);
  } catch (err: any) {
    console.error("[RecencyRescore] Uncaught:", err);
    return jsonResponse({ error: err?.message ?? String(err) }, 500);
  }
});

function chainSelf(supabaseUrl: string, supabaseKey: string): Promise<unknown> {
  const promise = fetch(`${supabaseUrl}/functions/v1/process-recency-rescore-tick`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  // Keep the isolate alive until the chain leaves the wire — same trick
  // process-company-batch-queue uses to avoid Deno tearing down the fetch.
  try {
    // @ts-ignore — EdgeRuntime is provided by the Supabase Deno runtime.
    (globalThis as any).EdgeRuntime?.waitUntil(promise);
    return Promise.resolve();
  } catch {
    return promise;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
