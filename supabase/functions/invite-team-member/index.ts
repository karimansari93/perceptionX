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
 * invite-team-member
 * ------------------
 * Team management for organization "Super Admins" (organization_members.role
 * IN ('owner','admin')). All writes to organization_invites and the auth
 * admin API live here so the client never needs elevated permissions.
 *
 * Body shape:
 *   {
 *     "action": "list" | "invite" | "resend" | "revoke",
 *     "organizationId": "<uuid>",
 *     "emails"?: string[],        // invite
 *     "role"?: "member"|"admin",  // invite (default "member")
 *     "inviteId"?: "<uuid>"       // resend / revoke
 *   }
 *
 * Rules enforced server-side:
 *   - Caller must be a Super Admin of the org (or a platform admin).
 *   - Invitee email domain must match the caller's email domain.
 *   - Email delivery: Resend when RESEND_API_KEY is set (branded
 *     "X invited you" email), otherwise Supabase's built-in invite email.
 */

// Keep in sync with is_admin() in the DB and ADMIN_EMAILS in the frontend.
const PLATFORM_ADMIN_EMAILS = [
  "admin@perceptionx.com",
  "karim@perceptionx.com",
  "karim@perceptionx.ai",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Durable, URL-safe invite token (256 bits of entropy). Embedded in the
// /welcome?invite=<token> link and exchanged for a fresh session by the
// redeem-invite function; good for 30 days from send/resend (expires_at).
const newInviteToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

type InviteBody = {
  action: "list" | "invite" | "resend" | "revoke";
  organizationId: string;
  emails?: string[];
  role?: "member" | "admin";
  inviteId?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // --- Authenticate caller -------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller?.email) return json({ error: "Invalid token" }, 401);

    const body = (await req.json()) as InviteBody;
    const { action, organizationId } = body ?? {};
    if (!action || !organizationId) {
      return json({ error: "action and organizationId are required" }, 400);
    }

    // --- Authorize: Super Admin of this org, or platform admin ----------
    const callerEmail = caller.email.toLowerCase();
    const isPlatformAdmin = PLATFORM_ADMIN_EMAILS.includes(callerEmail);

    const { data: callerMembership } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", caller.id)
      .maybeSingle();

    const isSuperAdmin =
      callerMembership?.role === "owner" || callerMembership?.role === "admin";
    if (!isPlatformAdmin && !isSuperAdmin) {
      return json({ error: "Only organization Super Admins can manage the team" }, 403);
    }

    const { data: org } = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .single();
    if (!org) return json({ error: "Organization not found" }, 404);

    // Inviter display name for the email copy: profile name → auth metadata
    // (SSO signups) → prettified email local part ("kerry.noone" → "Kerry Noone").
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", caller.id)
      .maybeSingle();
    const prettifyLocalPart = (email: string) =>
      email
        .split("@")[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    const inviterName =
      callerProfile?.full_name?.trim() ||
      (caller.user_metadata?.full_name as string | undefined)?.trim() ||
      (caller.user_metadata?.name as string | undefined)?.trim() ||
      prettifyLocalPart(caller.email);
    const inviterFirstName = inviterName.split(/\s+/)[0];

    const siteUrl =
      Deno.env.get("PUBLIC_SITE_URL") || req.headers.get("origin") || supabaseUrl;
    const redirectTo = `${siteUrl.replace(/\/$/, "")}/welcome`;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    // Reuse the batch-alert Slack webhook unless a dedicated invite one is set.
    const slackWebhook =
      Deno.env.get("INVITE_ALERTS_SLACK_WEBHOOK") ||
      Deno.env.get("BATCH_ALERTS_SLACK_WEBHOOK");

    // --- Shared helpers --------------------------------------------------

    // Posts "X invited Y to <org>" to Slack. Best-effort: never throws, so a
    // Slack outage can't fail an invite.
    const postSlackInvite = async (invited: string[], added: string[]) => {
      if (!slackWebhook || (!invited.length && !added.length)) return;
      const lines: string[] = [];
      if (invited.length) lines.push(`✉️ *Invited:* ${invited.join(", ")}`);
      if (added.length) lines.push(`➕ *Added existing user:* ${added.join(", ")}`);
      const count = invited.length + added.length;
      try {
        await fetch(slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${inviterName} invited ${count} teammate(s) to ${org.name}`,
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "🎉 New PerceptionX invite", emoji: true },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*${inviterName}* (${caller.email}) invited teammate(s) to *${org.name}*:`,
                },
              },
              { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
            ],
          }),
        });
      } catch (e) {
        console.error("Slack invite alert failed:", e);
      }
    };

    const sendInviteEmail = async (toEmail: string, actionLink: string) => {
      const fromAddress =
        Deno.env.get("INVITE_FROM_EMAIL") || "PerceptionX <team@perceptionx.ai>";
      const subject = `${inviterFirstName} invited you to join them on PerceptionX!`;
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1b2a4e;">
          <h2 style="margin:0 0 16px;">${inviterFirstName} invited you to join them on PerceptionX!</h2>
          <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
            Click this link to create your password and join them instantly.
          </p>
          <p style="margin:0 0 24px;">
            <a href="${actionLink}"
               style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
              Create your password
            </a>
          </p>
          <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0;">
            This link is valid for 30 days — ask ${inviterFirstName} to resend
            the invite if it has expired. If you weren't expecting this email,
            you can safely ignore it.
          </p>
        </div>`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: fromAddress, to: [toEmail], subject, html }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Resend API error (${res.status}): ${detail}`);
      }
    };

    const inviteMetadata = (email: string) => ({
      invited_org_id: org.id,
      invited_org_name: org.name,
      inviter_name: inviterName,
      invited_email: email,
    });

    // Creates the auth user, profile, membership and sends the invite email.
    // Returns the new user's id. `token` is the durable invite token: when
    // Resend is configured we email our own /welcome?invite=<token> link (good
    // for 30 days, refreshed on resend) instead of Supabase's short-lived auth
    // action link.
    const createAndInvite = async (
      email: string,
      role: string,
      token: string,
    ): Promise<string> => {
      let userId: string;
      let inviteLink: string | null = null;
      if (resendKey) {
        // generateLink creates the placeholder auth user (and never sends an
        // email itself); we discard its short-lived action_link and email the
        // durable token link instead.
        const { data, error } = await admin.auth.admin.generateLink({
          type: "invite",
          email,
          options: { data: inviteMetadata(email), redirectTo },
        });
        if (error) throw error;
        userId = data.user.id;
        inviteLink = `${siteUrl.replace(/\/$/, "")}/welcome?invite=${token}`;
      } else {
        // No Resend transport: fall back to Supabase's built-in invite email.
        // That link still carries the platform's 24h expiry (see config.toml).
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: inviteMetadata(email),
          redirectTo,
        });
        if (error) throw error;
        userId = data.user.id;
      }

      try {
        if (inviteLink) await sendInviteEmail(email, inviteLink);

        // No DB trigger creates profiles rows — the app's user lists read from
        // profiles, so create it here.
        await admin.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });

        const { error: memberError } = await admin.from("organization_members").insert({
          organization_id: org.id,
          user_id: userId,
          role,
        });
        if (memberError) throw memberError;
      } catch (err) {
        // Roll back the placeholder auth user (profile + memberships cascade
        // away with it). Without this, a transient failure — e.g. a Resend
        // outage — leaves an auth user with no profile, and every future
        // invite for this email fails with "already registered".
        try {
          await admin.auth.admin.deleteUser(userId);
        } catch (cleanupErr) {
          console.error(`Rollback of placeholder user for ${email} failed:`, cleanupErr);
        }
        throw err;
      }

      return userId;
    };

    // --- Actions ----------------------------------------------------------

    if (action === "list") {
      const { data: members } = await admin
        .from("organization_members")
        .select("id, user_id, role, joined_at")
        .eq("organization_id", organizationId)
        .order("joined_at", { ascending: true });

      const userIds = (members ?? []).map((m) => m.user_id);
      const { data: profiles } = userIds.length
        ? await admin.from("profiles").select("id, email, full_name").in("id", userIds)
        : { data: [] };

      const memberRows = await Promise.all(
        (members ?? []).map(async (m) => {
          const profile = profiles?.find((p) => p.id === m.user_id);
          let email = profile?.email ?? null;
          let lastSignInAt: string | null = null;
          const { data: authUser } = await admin.auth.admin.getUserById(m.user_id);
          if (authUser?.user) {
            email = email ?? authUser.user.email ?? null;
            lastSignInAt = authUser.user.last_sign_in_at ?? null;
          }
          return {
            id: m.id,
            user_id: m.user_id,
            email,
            full_name: profile?.full_name ?? null,
            role: m.role,
            joined_at: m.joined_at,
            has_signed_in: !!lastSignInAt,
          };
        }),
      );

      const { data: invites } = await admin
        .from("organization_invites")
        .select("id, email, role, status, invited_by, invited_user_id, sent_at, accepted_at")
        .eq("organization_id", organizationId)
        .order("sent_at", { ascending: false });

      // Lazily flip pending → accepted once the invitee has signed in.
      const inviteRows = await Promise.all(
        (invites ?? []).map(async (inv) => {
          if (inv.status !== "pending" || !inv.invited_user_id) return inv;
          const { data: invitee } = await admin.auth.admin.getUserById(inv.invited_user_id);
          const signedInAt = invitee?.user?.last_sign_in_at;
          if (!signedInAt) return inv;
          const accepted = { status: "accepted", accepted_at: signedInAt };
          await admin.from("organization_invites").update(accepted).eq("id", inv.id);
          return { ...inv, ...accepted };
        }),
      );

      return json({
        organization: org,
        callerRole: isPlatformAdmin ? "admin" : callerMembership?.role,
        members: memberRows,
        invites: inviteRows,
      });
    }

    if (action === "invite") {
      const role = body.role === "admin" ? "admin" : "member";
      const callerDomain = callerEmail.split("@")[1];
      const rawEmails = (body.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (!rawEmails.length) return json({ error: "At least one email is required" }, 400);

      const results: { email: string; status: string; message?: string }[] = [];

      for (const email of [...new Set(rawEmails)]) {
        try {
          if (!EMAIL_RE.test(email)) {
            results.push({ email, status: "error", message: "Invalid email address" });
            continue;
          }
          if (email.split("@")[1] !== callerDomain) {
            results.push({
              email,
              status: "error",
              message: `Email must be on your domain (@${callerDomain})`,
            });
            continue;
          }

          // Existing live invite for this org?
          const { data: existingInvite } = await admin
            .from("organization_invites")
            .select("id, status")
            .eq("organization_id", org.id)
            .eq("email", email)
            .eq("status", "pending")
            .maybeSingle();
          if (existingInvite) {
            results.push({ email, status: "already_invited", message: "Invite already pending — use resend" });
            continue;
          }

          // Existing user? (profiles is the app's canonical user list)
          const { data: existingProfile } = await admin
            .from("profiles")
            .select("id")
            .ilike("email", email)
            .maybeSingle();

          if (existingProfile) {
            const { data: existingMembership } = await admin
              .from("organization_members")
              .select("id")
              .eq("organization_id", org.id)
              .eq("user_id", existingProfile.id)
              .maybeSingle();
            if (existingMembership) {
              results.push({ email, status: "already_member", message: "Already a member of this organization" });
              continue;
            }

            const { error: memberError } = await admin.from("organization_members").insert({
              organization_id: org.id,
              user_id: existingProfile.id,
              role,
            });
            if (memberError) throw memberError;

            await admin.from("organization_invites").insert({
              organization_id: org.id,
              email,
              role,
              status: "accepted",
              invited_by: caller.id,
              invited_user_id: existingProfile.id,
              accepted_at: new Date().toISOString(),
            });

            results.push({ email, status: "added_existing", message: "Existing user added to the organization" });
            continue;
          }

          // Brand-new user → create + send invite email
          const token = newInviteToken();
          const userId = await createAndInvite(email, role, token);
          const { error: inviteError } = await admin.from("organization_invites").insert({
            organization_id: org.id,
            email,
            role,
            status: "pending",
            invited_by: caller.id,
            invited_user_id: userId,
            token,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });
          if (inviteError) {
            // The email already went out, but its token was never stored, so
            // the link is dead. Remove the placeholder user (profile +
            // membership cascade) so the address can be re-invited cleanly.
            try {
              await admin.auth.admin.deleteUser(userId);
            } catch (cleanupErr) {
              console.error(`Rollback of invite row for ${email} failed:`, cleanupErr);
            }
            throw inviteError;
          }
          results.push({ email, status: "invited" });
        } catch (err) {
          console.error(`Invite failed for ${email}:`, err);
          const raw = err instanceof Error ? err.message : "Invite failed";
          // An auth user without a profiles row (pre-rollback partial invite)
          // hits this; surface something actionable instead of a GoTrue error.
          const message = /already (been )?registered/i.test(raw)
            ? "This email already has an account — contact PerceptionX support to add them to your team"
            : raw;
          results.push({ email, status: "error", message });
        }
      }

      await postSlackInvite(
        results.filter((r) => r.status === "invited").map((r) => r.email),
        results.filter((r) => r.status === "added_existing").map((r) => r.email),
      );

      return json({ results });
    }

    if (action === "resend" || action === "revoke") {
      if (!body.inviteId) return json({ error: "inviteId is required" }, 400);
      const { data: invite } = await admin
        .from("organization_invites")
        .select("*")
        .eq("id", body.inviteId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!invite) return json({ error: "Invite not found" }, 404);
      if (invite.status !== "pending") {
        return json({ error: `Invite is already ${invite.status}` }, 400);
      }

      // If the invitee already signed in, the invite is effectively accepted.
      if (invite.invited_user_id) {
        const { data: invitee } = await admin.auth.admin.getUserById(invite.invited_user_id);
        const signedInAt = invitee?.user?.last_sign_in_at;
        if (signedInAt) {
          await admin
            .from("organization_invites")
            .update({ status: "accepted", accepted_at: signedInAt })
            .eq("id", invite.id);
          return json({ error: "This invite was already accepted" }, 400);
        }
      }

      if (action === "revoke") {
        // Never-signed-in invitee: remove the placeholder auth user entirely
        // (memberships cascade away with it).
        if (invite.invited_user_id) {
          await admin.auth.admin.deleteUser(invite.invited_user_id);
        }
        await admin
          .from("organization_invites")
          .update({ status: "revoked" })
          .eq("id", invite.id);
        return json({ ok: true, status: "revoked" });
      }

      // resend: recreate the placeholder user, issue a fresh durable token and
      // restart the 30-day window.
      if (invite.invited_user_id) {
        await admin.auth.admin.deleteUser(invite.invited_user_id);
      }
      const token = newInviteToken();
      const userId = await createAndInvite(invite.email, invite.role, token);
      await admin
        .from("organization_invites")
        .update({
          invited_user_id: userId,
          token,
          sent_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", invite.id);
      return json({ ok: true, status: "resent" });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("invite-team-member error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Internal error" },
      500,
    );
  }
});
