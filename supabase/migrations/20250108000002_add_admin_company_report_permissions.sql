-- Add admin permissions for company report functionality
-- This migration ensures admins can access company data for reporting

-- Create a function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if the current user's email is in the admin list
  -- You can modify this to use a proper admin table or role-based system
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND email IN (
      'admin@perceptionx.com',
      'karim@perceptionx.com'
      -- Add more admin emails as needed
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant admin access to view all company data
CREATE POLICY "Admins can view all company data" ON user_onboarding
  FOR SELECT USING (is_admin());

-- Grant admin access to view all prompt responses
CREATE POLICY "Admins can view all prompt responses" ON prompt_responses
  FOR SELECT USING (is_admin());

-- Grant admin access to view all AI themes
CREATE POLICY "Admins can view all AI themes" ON ai_themes
  FOR SELECT USING (is_admin());

-- Grant admin access to view all search insights
CREATE POLICY "Admins can view all search insights" ON search_insights_sessions
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can view all search results" ON search_insights_results
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can view all search terms" ON search_insights_terms
  FOR SELECT USING (is_admin());

-- Grant admin access to view all confirmed prompts
CREATE POLICY "Admins can view all confirmed prompts" ON confirmed_prompts
  FOR SELECT USING (is_admin());

-- Grant admin access to view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (is_admin());
