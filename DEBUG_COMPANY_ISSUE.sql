-- Debug the company switching issue
-- Check what companies exist for the user and what the default should be

-- First, let's see what user we're dealing with
SELECT 
  u.id as user_id,
  u.email,
  u.created_at as user_created_at
FROM auth.users u
ORDER BY u.created_at DESC
LIMIT 5;

-- Check organization memberships for the user
SELECT 
  om.user_id,
  om.organization_id,
  om.role,
  om.is_default,
  o.name as organization_name,
  o.created_at as org_created_at
FROM organization_members om
JOIN organizations o ON om.organization_id = o.id
ORDER BY om.created_at DESC
LIMIT 10;

-- Check companies in organizations
SELECT 
  oc.organization_id,
  oc.company_id,
  c.name as company_name,
  c.created_at as company_created_at,
  o.name as organization_name
FROM organization_companies oc
JOIN companies c ON oc.company_id = c.id
JOIN organizations o ON oc.organization_id = o.id
ORDER BY c.created_at DESC
LIMIT 10;

-- Check if the specific company ID exists
SELECT 
  id,
  name,
  industry,
  created_at,
  created_by
FROM companies 
WHERE id = '0325a8c3-c2f6-4e57-9597-91a46adc40ef';

-- Check if this company is linked to any organization
SELECT 
  oc.organization_id,
  oc.company_id,
  c.name as company_name,
  o.name as organization_name
FROM organization_companies oc
JOIN companies c ON oc.company_id = c.id
JOIN organizations o ON oc.organization_id = o.id
WHERE oc.company_id = '0325a8c3-c2f6-4e57-9597-91a46adc40ef';

-- Check what the user should see (complete query)
SELECT 
  om.user_id,
  om.organization_id,
  om.role,
  om.is_default as org_is_default,
  o.name as organization_name,
  oc.company_id,
  c.name as company_name,
  c.industry,
  c.created_at as company_created_at
FROM organization_members om
JOIN organizations o ON om.organization_id = o.id
JOIN organization_companies oc ON om.organization_id = oc.organization_id
JOIN companies c ON oc.company_id = c.id
WHERE om.user_id = (
  SELECT id FROM auth.users ORDER BY created_at DESC LIMIT 1
)
ORDER BY om.is_default DESC, c.created_at DESC;

