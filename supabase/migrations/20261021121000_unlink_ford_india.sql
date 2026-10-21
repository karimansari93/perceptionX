-- Ford India out of the Ford org; FBS India is the India view (Karim,
-- 2026-10-21). Follows 20261021120000, which moved msreesha@ford.com to FBS.
--
-- Ford India (01770fe2-…) keeps its company row, prompts and responses; only
-- the org link goes, so it drops out of the dashboard switcher and Amplify.
-- Amplify highlights are keyed by market, so the India cards stay reachable
-- under Ford Business Solutions.
--
-- Four users still default to Ford India with no location: they chose "Ford,
-- all countries" and Ford India was only the brand's first row. Repoint them
-- to Ford US (10b51b2d-…) so they keep the same view.
--
-- Rollback values:
--   organization_companies row: id 3d4f3bee-eb28-4b36-a907-39291e4264ba,
--     organization_id 0af791f6-db6e-4063-95c4-71cd31f8779a,
--     company_id 01770fe2-cdee-4a5b-9b07-fc4ffc028ee5,
--     added_at 2026-04-30 08:58:42.891847+00,
--     added_by 95271cff-03ee-4b39-9632-70ed3b141d88
--   default_company_id (profiles and user_metadata) = 01770fe2-… for
--     ccorre31, hsheikh1, fdetitto, kwilhe11 @ford.com

update public.profiles
set default_company_id = '10b51b2d-1969-4822-b88f-aae6db817dc4'
where default_company_id = '01770fe2-cdee-4a5b-9b07-fc4ffc028ee5';

update auth.users
set raw_user_meta_data = raw_user_meta_data
  || jsonb_build_object('default_company_id', '10b51b2d-1969-4822-b88f-aae6db817dc4')
where raw_user_meta_data->>'default_company_id' = '01770fe2-cdee-4a5b-9b07-fc4ffc028ee5';

delete from public.organization_companies
where id = '3d4f3bee-eb28-4b36-a907-39291e4264ba';
