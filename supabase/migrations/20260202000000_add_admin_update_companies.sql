-- Allow admins to update companies (e.g. cancel collection: data_collection_status, data_collection_progress)
-- Required for admin panel "Cancel collection" when admin is not a member of the company
CREATE POLICY "Admins can update companies" ON companies
  FOR UPDATE TO authenticated
  USING ((select is_admin()))
  WITH CHECK ((select is_admin()));
