-- FBS India as msreesha@ford.com's landing view (Karim, 2026-10-21).
--
-- She works for Ford Business Solutions but lands on Ford India
-- (01770fe2-…), the "Ford" brand filtered to India, and reads its
-- automotive peer set as FBS's. Point her default at Ford Business
-- Solutions India (6013cdc4-…); her location stays India.
--
-- Previous values, for rollback:
--   profiles.default_company_id               = 01770fe2-cdee-4a5b-9b07-fc4ffc028ee5
--   raw_user_meta_data.default_company_id     = 01770fe2-cdee-4a5b-9b07-fc4ffc028ee5
--   raw_user_meta_data.default_company_name   = Ford
--
-- Ford India stays linked to the Ford org: the "Global" Amplify link builds
-- its market cards from organization_companies, and process-company-batch-queue
-- refuses jobs for unlinked companies. The four other users defaulting to
-- Ford India have no location (Ford, all countries) and are left as they are.

update public.profiles
set default_company_id = '6013cdc4-5936-4436-86fe-852382469f94'
where id = '902abf1c-31d9-442c-aebb-5e6d5c3979ab'
  and default_company_id = '01770fe2-cdee-4a5b-9b07-fc4ffc028ee5';

update auth.users
set raw_user_meta_data = raw_user_meta_data
  || jsonb_build_object(
       'default_company_id', '6013cdc4-5936-4436-86fe-852382469f94',
       'default_company_name', 'Ford Business Solutions')
where id = '902abf1c-31d9-442c-aebb-5e6d5c3979ab'
  and raw_user_meta_data->>'default_company_id' = '01770fe2-cdee-4a5b-9b07-fc4ffc028ee5';
