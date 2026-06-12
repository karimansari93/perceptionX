-- Team invites: org owners/admins ("Super Admins") can invite same-domain
-- teammates into their organization from the dashboard.
--
-- All invite writes go through the invite-team-member edge function
-- (service role), so organization_invites has SELECT-only policies.

-- 1. Invites table
CREATE TABLE IF NOT EXISTS organization_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- auth user created (or matched) for this invite; cascade so deleting the
  -- auth user (e.g. revoking a never-accepted invite) cleans up via edge fn
  invited_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org_id ON organization_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON organization_invites(LOWER(email));
-- At most one live invite per email per org
CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_invites_pending
  ON organization_invites(organization_id, LOWER(email))
  WHERE status = 'pending';

CREATE TRIGGER update_organization_invites_updated_at
  BEFORE UPDATE ON organization_invites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Helper: is the current user an owner/admin ("Super Admin") of the org?
-- SECURITY DEFINER so policies on organization_members itself can call it
-- without recursing into that table's own policies.
CREATE OR REPLACE FUNCTION public.is_org_super_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_org_super_admin(UUID) TO authenticated;

-- 3. RLS on organization_invites (reads only; writes are service-role only)
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_invites_select_policy ON organization_invites
  FOR SELECT TO authenticated
  USING (is_admin() OR is_org_super_admin(organization_id));

-- 4. Super admins can see their org's full member list (Team page).
-- Previously members could only see their own membership row.
CREATE POLICY "Org super admins can view their org members"
  ON organization_members FOR SELECT
  TO authenticated
  USING (is_org_super_admin(organization_id));

-- 5. Tighten membership writes. The original INSERT policy was
-- WITH CHECK (true), which let any authenticated user insert themselves
-- (or anyone) into any organization with any role.
DROP POLICY IF EXISTS "Users can insert org memberships" ON organization_members;

CREATE POLICY "Admins can insert org memberships"
  ON organization_members FOR INSERT
  TO authenticated
  WITH CHECK (is_admin() OR is_org_super_admin(organization_id));

-- Role changes (Super Admin promote/demote) from the admin panel and Team page
CREATE POLICY "Admins can update org memberships"
  ON organization_members FOR UPDATE
  TO authenticated
  USING (is_admin() OR is_org_super_admin(organization_id))
  WITH CHECK (is_admin() OR is_org_super_admin(organization_id));

CREATE POLICY "Admins can delete org memberships"
  ON organization_members FOR DELETE
  TO authenticated
  USING (is_admin() OR is_org_super_admin(organization_id));

COMMENT ON TABLE organization_invites IS 'Pending/accepted/revoked teammate invites, written only by the invite-team-member edge function';
COMMENT ON FUNCTION public.is_org_super_admin(UUID) IS 'True when auth.uid() has owner/admin role in the given organization';
