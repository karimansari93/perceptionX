import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Inlined (not imported from ../_shared/cors.ts) so the function can be
// deployed as a single file.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-client-host, x-client-platform, x-client-language, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * send-intake-invite
 * ------------------
 * Emails a client their tokenized onboarding link ("complete your project
 * brief"). Admin-only (profiles.is_admin). The link is rebuilt server-side from
 * the invite's own token, so the caller can never route a token to a different
 * address than the one locked into the invite.
 *
 * Delivery goes through the project's own SMTP (the same SMTP the Supabase
 * project is configured with) — no third-party email provider, and no auth
 * user is created for the external contact. Required secrets:
 *   SMTP_HOST, SMTP_USER, SMTP_PASS   (SMTP_PORT optional, default 465)
 *   INTAKE_FROM_EMAIL                 (optional "Name <addr>", default below)
 *   PUBLIC_SITE_URL                   (optional link base, else request origin)
 * With SMTP unset the function returns { sent:false, reason:"no_smtp" } so the
 * admin UI falls back to the copyable link.
 *
 * Body: { "inviteId": "<uuid>" }
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inviteEmailHtml(company: string, link: string, expiresAt: string): string {
  const c = escapeHtml(company);
  const expires = new Date(expiresAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#FFF1F5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF1F5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <!-- Wordmark -->
          <tr><td style="padding:0 8px 16px;">
            <span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#13274F;letter-spacing:-0.3px;">Perception<span style="color:#DB5E89;">X</span></span>
          </td></tr>

          <!-- Card -->
          <tr><td style="background-color:#ffffff;border-radius:16px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <div style="height:4px;width:48px;background-color:#0CBCB9;border-radius:2px;margin-bottom:24px;"></div>

            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.35;color:#13274F;font-weight:700;">
              You're invited to set up ${c}'s PerceptionX project
            </h1>

            <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3c4a6b;">
              PerceptionX measures how AI assistants — ChatGPT, Claude, Gemini and
              Perplexity — describe ${c} to job seekers, so you can see and shape
              the story candidates hear.
            </p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#3c4a6b;">
              Before we start tracking, we need about <strong style="color:#13274F;">5 minutes</strong> from you:
              a short, guided set of questions that becomes your project brief. Your
              project is already named — no forms to fill about who you are.
            </p>

            <!-- What to have handy -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F7F9FC;border-radius:12px;margin:0 0 28px;">
              <tr><td style="padding:18px 20px;">
                <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.6px;text-transform:uppercase;color:#8a94ab;font-weight:600;">Worth having handy</p>
                <p style="margin:0;font-size:14px;line-height:1.9;color:#3c4a6b;">
                  &#8226;&nbsp; Your careers page link<br/>
                  &#8226;&nbsp; The markets and job functions you hire for<br/>
                  &#8226;&nbsp; Your top talent priorities for the next 12 months
                </p>
              </td></tr>
            </table>

            <!-- CTA -->
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr><td style="border-radius:999px;background-color:#DB5E89;">
                <a href="${link}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">
                  Complete your project brief
                </a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;line-height:1.6;color:#8a94ab;">
              This link is live until <strong style="color:#3c4a6b;">${expires}</strong> and is
              unique to ${c} — please don't forward it. Your progress saves as you
              go, so you can leave and pick up where you stopped.
            </p>
          </td></tr>

          <!-- Footer -->
          <tr><td style="padding:20px 8px 0;text-align:center;">
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#a8b0c2;line-height:1.6;">
              Sent by the PerceptionX team because we're setting up a project for ${c}.<br/>
              Didn't expect this? You can safely ignore it.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function inviteEmailText(company: string, link: string): string {
  return [
    `You're invited to set up ${company}'s PerceptionX project.`,
    ``,
    `PerceptionX measures how AI assistants (ChatGPT, Claude, Gemini, Perplexity)`,
    `describe ${company} to job seekers. Before we start tracking, we need about`,
    `5 minutes from you — a short, guided set of questions that becomes your`,
    `project brief.`,
    ``,
    `Complete your project brief: ${link}`,
    ``,
    `Your progress saves as you go, so you can leave and pick up where you stopped.`,
  ].join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // --- Authenticate + authorize (platform admins only) ----------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller) return json({ error: "Invalid token" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .maybeSingle();
    if (!profile?.is_admin) return json({ error: "Admin only" }, 403);

    const { inviteId } = (await req.json()) as { inviteId?: string };
    if (!inviteId) return json({ error: "inviteId is required" }, 400);

    const { data: invite } = await admin
      .from("intake_invites")
      .select("id, company_name, contact_email, token, expires_at, status")
      .eq("id", inviteId)
      .maybeSingle();
    if (!invite) return json({ error: "Invite not found" }, 404);

    // --- Deliver via the project's SMTP (no third-party provider) --------
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ sent: false, reason: "no_smtp" });
    }
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "465");
    const fromAddress =
      Deno.env.get("INTAKE_FROM_EMAIL") || "PerceptionX <team@perceptionx.ai>";

    const siteUrl =
      Deno.env.get("PUBLIC_SITE_URL") || req.headers.get("origin") || supabaseUrl;
    const link = `${siteUrl.replace(/\/$/, "")}/onboarding/${invite.token}`;

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        // Port 465 speaks TLS immediately; 587/25 upgrade via STARTTLS.
        tls: smtpPort === 465,
        auth: { username: smtpUser, password: smtpPass },
      },
    });

    try {
      await client.send({
        from: fromAddress,
        to: invite.contact_email,
        subject: `You're invited to set up ${invite.company_name}'s PerceptionX project`,
        content: inviteEmailText(invite.company_name, link),
        html: inviteEmailHtml(invite.company_name, link, invite.expires_at),
      });
      await client.close();
    } catch (e) {
      console.error("SMTP send failed:", e);
      try {
        await client.close();
      } catch (_) {
        // ignore close error
      }
      return json({ sent: false, reason: "send_failed" }, 502);
    }

    return json({ sent: true });
  } catch (e) {
    console.error("send-intake-invite failed:", e);
    return json({ error: String(e) }, 500);
  }
});
