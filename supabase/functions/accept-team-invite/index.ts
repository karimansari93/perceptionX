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
 * accept-team-invite
 * ------------------
 * Public (verify_jwt = false): the 30-day invite token IS the credential,
 * exactly like the intake_invites onboarding flow. Counterpart of
 * invite-team-member, which mints the tokens.
 *
 * Body shape:
 *   { "action": "lookup", "token": "<invite token>" }
 *     → { valid: true, email, inviterName, orgName }
 *     → { valid: false, reason: "not_found" | "expired" | "revoked" | "accepted" }
 *
 *   { "action": "accept", "token": "...", "password": "...", "fullName": "..." }
 *     → { ok: true, email }   // client then signs in with email + password
 *
 * accept validates the password server-side (this endpoint is public), sets
 * it on the placeholder auth user, confirms the email, syncs the profile and
 * membership, and marks the invite accepted — making the token single-use.
 */

type AcceptBody = {
  action: "lookup" | "accept";
  token?: string;
  password?: string;
  fullName?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Keep in sync with validatePassword() in src/pages/Welcome.tsx.
const passwordError = (password: string): string | null => {
  if (password.length < 8) return "Password must be at least 8 characters long";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as AcceptBody;
    const { action, token } = body ?? {};
    if (!action || !token) {
      return json({ error: "action and token are required" }, 400);
    }

    const { data: invite } = await admin
      .from("organization_invites")
      .select("id, organization_id, email, role, status, invited_by, invited_user_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!invite) return json({ valid: false, reason: "not_found" });
    if (invite.status === "revoked") return json({ valid: false, reason: "revoked" });
    if (invite.status === "accepted") return json({ valid: false, reason: "accepted" });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return json({ valid: false, reason: "expired" });
    }

    if (action === "lookup") {
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", invite.organization_id)
        .maybeSingle();
      const { data: inviter } = invite.invited_by
        ? await admin.from("profiles").select("full_name").eq("id", invite.invited_by).maybeSingle()
        : { data: null };
      let inviterName = inviter?.full_name ?? null;
      if (!inviterName && invite.invited_user_id) {
        // Fall back to the inviter name stamped into the placeholder's metadata
        const { data: placeholder } = await admin.auth.admin.getUserById(invite.invited_user_id);
        inviterName = (placeholder?.user?.user_metadata?.inviter_name as string | undefined) ?? null;
      }
      return json({
        valid: true,
        email: invite.email,
        inviterName,
        orgName: org?.name ?? null,
      });
    }

    if (action === "accept") {
      const password = body.password ?? "";
      const fullName = (body.fullName ?? "").trim();
      if (!fullName) return json({ error: "Please enter your name" }, 400);
      const pwError = passwordError(password);
      if (pwError) return json({ error: pwError }, 400);

      // Placeholder user should exist from invite time; recreate defensively
      // if it was cleaned up out-of-band.
      let userId = invite.invited_user_id as string | null;
      if (userId) {
        const { data: existing } = await admin.auth.admin.getUserById(userId);
        if (!existing?.user) userId = null;
      }
      if (!userId) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: invite.email,
        });
        if (createError) throw createError;
        userId = created.user.id;
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, name: fullName },
      });
      if (updateError) throw updateError;

      // The name is what teammates see in invite emails when this user
      // invites others later.
      await admin
        .from("profiles")
        .upsert({ id: userId, email: invite.email, full_name: fullName }, { onConflict: "id" });

      // Membership normally exists from invite time; ensure it defensively.
      const { data: membership } = await admin
        .from("organization_members")
        .select("id")
        .eq("organization_id", invite.organization_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!membership) {
        const { error: memberError } = await admin.from("organization_members").insert({
          organization_id: invite.organization_id,
          user_id: userId,
          role: invite.role,
        });
        if (memberError) throw memberError;
      }

      const { error: acceptError } = await admin
        .from("organization_invites")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          invited_user_id: userId,
        })
        .eq("id", invite.id)
        .eq("status", "pending");
      if (acceptError) throw acceptError;

      return json({ ok: true, email: invite.email });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("accept-team-invite error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Internal error" },
      500,
    );
  }
});
