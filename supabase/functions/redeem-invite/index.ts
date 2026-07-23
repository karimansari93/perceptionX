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
 * redeem-invite
 * -------------
 * Exchanges a durable team-invite token (from the /welcome?invite=<token> link
 * created by invite-team-member) for a freshly-minted, short-lived auth OTP the
 * browser immediately verifies to sign in. Because the OTP is generated at click
 * time, the emailed invite link never expires — it only stops working once the
 * invite has been accepted (the invitee already signed in) or revoked.
 *
 * Body: { "token": "<durable invite token>" }
 * Returns on success: { ok, tokenHash, type, orgName, inviterName }
 *         otherwise:   { ok: false, reason: "invalid" | "used" }
 */

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

    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const token = (body.token ?? "").trim();
    if (!token) return json({ ok: false, reason: "invalid" }, 400);

    const { data: invite } = await admin
      .from("organization_invites")
      .select("id, organization_id, email, status, invited_user_id")
      .eq("token", token)
      .maybeSingle();

    // Unknown token, or an invite that's no longer live (revoked/accepted).
    if (!invite || invite.status !== "pending") {
      return json({ ok: false, reason: invite ? "used" : "invalid" });
    }

    // The invitee has an auth user from the original invite. If they've already
    // signed in once, the invite is effectively accepted — reconcile the row and
    // refuse to re-mint (the link is not a permanent credential). They can sign
    // in normally, or reset their password, from /auth.
    if (!invite.invited_user_id) return json({ ok: false, reason: "invalid" });
    const { data: invitee } = await admin.auth.admin.getUserById(invite.invited_user_id);
    if (!invitee?.user?.email) return json({ ok: false, reason: "invalid" });
    if (invitee.user.last_sign_in_at) {
      await admin
        .from("organization_invites")
        .update({ status: "accepted", accepted_at: invitee.user.last_sign_in_at })
        .eq("id", invite.id);
      return json({ ok: false, reason: "used" });
    }

    // Mint a fresh magic-link OTP for this user. The browser verifies it right
    // away (supabase.auth.verifyOtp) to establish the session — so nothing that
    // travels by email ever has to still be valid.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: invitee.user.email,
    });
    if (linkError || !link?.properties?.hashed_token) {
      console.error("redeem-invite generateLink failed:", linkError);
      return json({ ok: false, reason: "invalid" }, 500);
    }

    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", invite.organization_id)
      .maybeSingle();

    const inviterName =
      (invitee.user.user_metadata?.inviter_name as string | undefined) ?? null;

    return json({
      ok: true,
      tokenHash: link.properties.hashed_token,
      type: "magiclink",
      orgName: org?.name ?? null,
      inviterName,
    });
  } catch (error) {
    console.error("redeem-invite error:", error);
    return json({ ok: false, reason: "invalid" }, 500);
  }
});
