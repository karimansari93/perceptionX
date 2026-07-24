-- Team invite links move off Supabase's auth action links (capped at a
-- 24-hour lifetime by the project's Email OTP expiry — and set to 1 hour in
-- production, which kept expiring links under invitees) onto our own tokens
-- with a 30-day lifetime, mirroring intake_invites.
--
-- The token column already exists in production (added out-of-band, never
-- populated); IF NOT EXISTS makes fresh environments converge on the same
-- shape. Tokens are generated in the invite-team-member edge function
-- (24 random bytes, base64url) and accepted by accept-team-invite.

ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS token TEXT;

ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');

-- Existing rows: date the 30-day window from the original send, not from
-- when this migration runs.
UPDATE public.organization_invites
  SET expires_at = sent_at + INTERVAL '30 days';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_invites_token
  ON public.organization_invites (token)
  WHERE token IS NOT NULL;

COMMENT ON COLUMN public.organization_invites.token IS
  'URL token for /welcome?invite=<token>; single-use, written only by invite-team-member';
COMMENT ON COLUMN public.organization_invites.expires_at IS
  'Invite link lifetime (30 days from send/resend); checked by accept-team-invite';
