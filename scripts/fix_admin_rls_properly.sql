-- Fix RLS for admin access properly
-- Run this in your Supabase SQL Editor

-- Re-enable RLS on all tables (in case we disabled them)
ALTER TABLE confirmed_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies that might be conflicting
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Allow all authenticated users to read profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;

-- Create proper policies for profiles
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create admin policy for profiles (allows admin to see all profiles)
CREATE POLICY "Admin can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND email = 'karim@perceptionx.ai'
    )
  );

-- Create admin policy for confirmed_prompts (allows admin to see all prompts)
CREATE POLICY "Admin can view all confirmed prompts" ON confirmed_prompts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND email = 'karim@perceptionx.ai'
    )
  );

-- Create admin policy for prompt_responses (allows admin to see all responses)
CREATE POLICY "Admin can view all prompt responses" ON prompt_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND email = 'karim@perceptionx.ai'
    )
  );

-- Create admin policy for organizations (allows admin to see all organizations)
CREATE POLICY "Admin can view all organizations" ON organizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND email = 'karim@perceptionx.ai'
    )
  );

-- Create admin policy for organization_companies (allows admin to see all org companies)
CREATE POLICY "Admin can view all organization companies" ON organization_companies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND email = 'karim@perceptionx.ai'
    )
  );

-- Create admin policy for companies (allows admin to see all companies)
CREATE POLICY "Admin can view all companies" ON companies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND email = 'karim@perceptionx.ai'
    )
  );

-- Test the admin function
SELECT 
  auth.uid() as current_user_id,
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND email = 'karim@perceptionx.ai'
  ) as is_admin;
















