-- Durable, non-expiring team invite links.
--
-- Supabase's built-in auth invite links are OTP links capped at a 24h lifetime,
-- so invitees who clicked late hit the "Invite link expired" dead end. We switch
-- team invites to our own token (the same pattern as intake_invites): the email
-- carries this token, and the redeem-invite edge function exchanges it for a
-- freshly-minted auth session at click time. The token itself never expires — it
-- simply stops working once the invite is accepted or revoked.
--
-- The token is read only by the service-role edge function (redeem-invite), never
-- by the client, so no RLS/grant changes are needed here.

ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_invites_token
  ON organization_invites(token)
  WHERE token IS NOT NULL;

COMMENT ON COLUMN organization_invites.token IS
  'Durable, non-expiring invite token embedded in the /welcome?invite=<token> link. Exchanged server-side by the redeem-invite edge function for a fresh auth session. NULL for legacy invites created before token links.';
