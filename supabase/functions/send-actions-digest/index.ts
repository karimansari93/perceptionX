import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inlined (not imported from ../_shared/cors.ts) so the function can be
// deployed as a single file.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-client-host, x-client-platform, x-client-language, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * send-actions-digest
 * -------------------
 * One email per person when a quarter's actions go live: "You have N new
 * actions on PerceptionX", with the titles and a link to /actions.
 *
 * Deliberately manual (platform admin only, invoked once per edition) rather
 * than triggered on insert — a quarter gets authored over hours, and nobody
 * should get an email per row while we are still writing them.
 *
 * Body: { "organizationId": "<uuid>", "dryRun": true }
 *
 * Selects published actions with notified_at IS NULL and:
 *   - mails each assignee their own list
 *   - mails org owners/admins about anything still unassigned, because
 *     self-assign only works if somebody knows there is a queue
 * then stamps notified_at so a re-run is a no-op.
 */

const PLATFORM_ADMIN_EMAILS = [
  "admin@perceptionx.com",
  "karim@perceptionx.com",
  "karim@perceptionx.ai",
];

const APP_URL = Deno.env.get("APP_URL") ?? "https://app.perceptionx.ai";

type DigestBody = { organizationId: string; dryRun?: boolean };

type ActionRow = {
  id: string;
  title: string;
  markets: string[] | null;
  register: string;
  overdue_count: number;
  assignee_id: string | null;
  period_label: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // --- Authenticate caller: platform admin only ----------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !caller?.email) return json({ error: "Invalid token" }, 401);
    if (!PLATFORM_ADMIN_EMAILS.includes(caller.email.toLowerCase())) {
      return json({ error: "Only platform admins can send an actions digest" }, 403);
    }

    const { organizationId, dryRun = false } = (await req.json()) as DigestBody;
    if (!organizationId) return json({ error: "organizationId is required" }, 400);

    // Actions are org-scoped: a client org holds one company profile per
    // market, and the report spans all of them.
    const { data: org } = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .maybeSingle();
    if (!org) return json({ error: "Organization not found" }, 404);

    // --- Unnotified published actions ----------------------------------
    const { data: actions, error: actionsError } = await admin
      .from("company_actions")
      .select("id, title, markets, register, overdue_count, assignee_id, period_label")
      .eq("organization_id", organizationId)
      .not("published_at", "is", null)
      .is("notified_at", null);

    if (actionsError) return json({ error: actionsError.message }, 500);
    if (!actions || actions.length === 0) {
      return json({ sent: 0, message: "No unnotified actions for this organization" });
    }

    // --- Recipients -----------------------------------------------------
    const byAssignee = new Map<string, ActionRow[]>();
    const unassigned: ActionRow[] = [];
    for (const action of actions as ActionRow[]) {
      if (action.assignee_id) {
        const list = byAssignee.get(action.assignee_id) ?? [];
        list.push(action);
        byAssignee.set(action.assignee_id, list);
      } else {
        unassigned.push(action);
      }
    }

    const { data: members } = await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId);

    const recipientIds = new Set<string>(byAssignee.keys());
    const superAdminIds = (members ?? [])
      .filter((m) => m.role === "owner" || m.role === "admin")
      .map((m) => m.user_id as string);
    if (unassigned.length > 0) superAdminIds.forEach((id) => recipientIds.add(id));

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", Array.from(recipientIds));

    const profileById = new Map(
      (profiles ?? []).map((p) => [p.id as string, p as { email: string | null; full_name: string | null }]),
    );

    // --- Compose + send -------------------------------------------------
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM") ?? "PerceptionX <hello@perceptionx.ai>";

    const actionLine = (a: ActionRow) => {
      const markets = (a.markets ?? []).join(", ");
      const overdue = a.overdue_count > 1 ? ` · overdue ×${a.overdue_count}` : "";
      return `<li style="margin:0 0 8px;">
        <span style="font-weight:600;">${escapeHtml(a.title)}</span>
        <span style="color:#6b7280;">${markets ? ` · ${escapeHtml(markets)}` : ""}${overdue}</span>
      </li>`;
    };

    const buildHtml = (name: string, owned: ActionRow[], needsOwner: ActionRow[], period: string) => `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;color:#111827;">
        <p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
        ${
          owned.length > 0
            ? `<p style="margin:0 0 12px;">You have <strong>${owned.length} new ${
                owned.length === 1 ? "action" : "actions"
              }</strong> from the ${escapeHtml(period)} ${escapeHtml(org.name)} report:</p>
               <ul style="margin:0 0 20px;padding-left:20px;">${owned.map(actionLine).join("")}</ul>`
            : ""
        }
        ${
          needsOwner.length > 0
            ? `<p style="margin:0 0 12px;"><strong>${needsOwner.length} ${
                needsOwner.length === 1 ? "action needs" : "actions need"
              } an owner:</strong></p>
               <ul style="margin:0 0 20px;padding-left:20px;">${needsOwner.map(actionLine).join("")}</ul>`
            : ""
        }
        <p style="margin:0 0 24px;">
          <a href="${APP_URL}/actions"
             style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
            Open your actions
          </a>
        </p>
        <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0;">
          Each action shows what the data says and links to the sources AI reads.
          Mark one done when you've handled it and we'll check it against the next report.
        </p>
      </div>`;

    const results: { email: string; owned: number; unassigned: number; sent: boolean }[] = [];

    for (const userId of recipientIds) {
      const profile = profileById.get(userId);
      if (!profile?.email) continue;

      const owned = byAssignee.get(userId) ?? [];
      const needsOwner = superAdminIds.includes(userId) ? unassigned : [];
      if (owned.length === 0 && needsOwner.length === 0) continue;

      const name = profile.full_name?.trim() || profile.email.split("@")[0];
      const period = (owned[0] ?? needsOwner[0])?.period_label ?? "latest";
      const subject =
        owned.length > 0
          ? `You have ${owned.length} new ${owned.length === 1 ? "action" : "actions"} on PerceptionX`
          : `${needsOwner.length} ${needsOwner.length === 1 ? "action needs" : "actions need"} an owner`;

      if (dryRun || !resendKey) {
        results.push({ email: profile.email, owned: owned.length, unassigned: needsOwner.length, sent: false });
        continue;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [profile.email],
          subject,
          html: buildHtml(name, owned, needsOwner, period),
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error(`Resend error for ${profile.email} (${res.status}): ${detail}`);
        results.push({ email: profile.email, owned: owned.length, unassigned: needsOwner.length, sent: false });
        continue;
      }
      results.push({ email: profile.email, owned: owned.length, unassigned: needsOwner.length, sent: true });
    }

    // Only stamp on a real send. A dry run leaves everything re-sendable, and
    // a failed send stays in the queue for the next run.
    if (!dryRun && results.some((r) => r.sent)) {
      const { error: stampError } = await admin
        .from("company_actions")
        .update({ notified_at: new Date().toISOString() })
        .in("id", (actions as ActionRow[]).map((a) => a.id));
      if (stampError) console.error(`Failed to stamp notified_at: ${stampError.message}`);
    }

    return json({
      dryRun,
      actions: actions.length,
      unassigned: unassigned.length,
      recipients: results,
      sent: results.filter((r) => r.sent).length,
    });
  } catch (error) {
    console.error("send-actions-digest error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
