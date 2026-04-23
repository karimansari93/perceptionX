import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * send-batch-alert
 * -----------------
 * Posts a short message to the Slack incoming webhook configured in
 * Deno.env.get('BATCH_ALERTS_SLACK_WEBHOOK'). Meant to be called from
 * pg_cron jobs that monitor company_batch_queue — watchdog, config
 * completion, monthly refresh kickoff.
 *
 * Body shape:
 *   {
 *     "event": "stuck_jobs_reset" | "config_completed" | "config_failed"
 *            | "monthly_refresh_started" | "custom",
 *     "title"?: string,       // overrides the default title for this event
 *     "text"?: string,        // free-form body text
 *     "fields"?: { label: string; value: string }[]  // optional key/value rows
 *   }
 *
 * Keeping the edge function thin on purpose: no business logic lives here,
 * just formatting and the HTTP POST. That way the pg_cron jobs own the
 * "when do we alert" decision and the Slack URL never leaves the edge runtime.
 */

type AlertBody = {
  event: string;
  title?: string;
  text?: string;
  fields?: { label: string; value: string }[];
};

const DEFAULT_TITLES: Record<string, string> = {
  stuck_jobs_reset: "⚠️ Batch watchdog: reset stranded jobs",
  config_completed: "✅ Batch config completed",
  config_failed: "❌ Batch config failed",
  monthly_refresh_started: "🔄 Monthly refresh triggered",
  custom: "ℹ️ Batch alert",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const webhook = Deno.env.get("BATCH_ALERTS_SLACK_WEBHOOK");
    if (!webhook) {
      // Not configured — return 200 so pg_cron doesn't retry forever.
      return new Response(
        JSON.stringify({ ok: true, skipped: "no webhook configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as AlertBody;
    if (!body?.event) {
      return new Response(
        JSON.stringify({ ok: false, error: "event is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const title = body.title ?? DEFAULT_TITLES[body.event] ?? DEFAULT_TITLES.custom;

    // Build a Slack Block Kit message. Using blocks over the legacy
    // attachments API so formatting works in every modern workspace.
    const blocks: any[] = [
      {
        type: "header",
        text: { type: "plain_text", text: title, emoji: true },
      },
    ];

    if (body.text) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: body.text },
      });
    }

    if (body.fields && body.fields.length > 0) {
      // Slack only supports up to 10 fields per section; chunk defensively.
      for (let i = 0; i < body.fields.length; i += 10) {
        const slice = body.fields.slice(i, i + 10);
        blocks.push({
          type: "section",
          fields: slice.map((f) => ({
            type: "mrkdwn",
            text: `*${f.label}*\n${f.value}`,
          })),
        });
      }
    }

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `event: \`${body.event}\` · ${new Date().toISOString()}`,
        },
      ],
    });

    const slackRes = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      console.warn(`[send-batch-alert] Slack rejected (${slackRes.status}): ${errText}`);
      return new Response(
        JSON.stringify({ ok: false, slackStatus: slackRes.status, slackBody: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[send-batch-alert] error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
