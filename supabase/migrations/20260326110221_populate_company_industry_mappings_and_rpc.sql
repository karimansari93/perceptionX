-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260326110221; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Repopulate company_industry_mappings with latest rules
DELETE FROM public.company_industry_mappings;

INSERT INTO public.company_industry_mappings (company_name, industry_context) VALUES
  ('google', 'Artificial Intelligence'), ('google', 'Cloud Data Platform'), ('google', 'Electronics'), ('google', 'Enterprise Software'), ('google', 'Technology'),
  ('microsoft', 'Cloud Data Platform'), ('microsoft', 'Cybersecurity'), ('microsoft', 'Electronics'), ('microsoft', 'Enterprise Software'), ('microsoft', 'Technology'),
  ('alibaba', 'Artificial Intelligence'), ('alibaba', 'Cloud Data Platform'), ('alibaba', 'Cybersecurity'), ('alibaba', 'Electronics'), ('alibaba', 'Technology'), ('alibaba', 'Telecommunications'),
  ('salesforce', 'Cloud Data Platform'), ('salesforce', 'Enterprise Software'), ('salesforce', 'Technology'),
  ('amazon', 'Apparel'), ('amazon', 'Artificial Intelligence'), ('amazon', 'Automotive'), ('amazon', 'Beauty'), ('amazon', 'Cloud Data Platform'), ('amazon', 'Cybersecurity'), ('amazon', 'Electronics'), ('amazon', 'Enterprise Software'), ('amazon', 'Gaming'), ('amazon', 'Logistics'), ('amazon', 'Manufacturing & Industrial'), ('amazon', 'Media & Entertainment'), ('amazon', 'Retail'), ('amazon', 'Technology'),
  ('loreal', 'Apparel'), ('loreal', 'Artificial Intelligence'), ('loreal', 'Beauty'), ('loreal', 'Electronics'), ('loreal', 'FMCG'), ('loreal', 'Healthcare'), ('loreal', 'Hospitality'), ('loreal', 'Logistics'), ('loreal', 'Manufacturing & Industrial'), ('loreal', 'Media & Entertainment'), ('loreal', 'Pharmaceutical'), ('loreal', 'Retail'), ('loreal', 'Technology'), ('loreal', 'Travel'),
  ('pwc', 'Consulting'),
  ('accenture', 'Consulting'), ('accenture', 'Technology'),
  ('sap', 'Artificial Intelligence'), ('sap', 'Electronics'), ('sap', 'Enterprise Software'), ('sap', 'Technology'), ('sap', 'Telecommunications'),
  ('ey', 'Artificial Intelligence'), ('ey', 'Consulting'), ('ey', 'Enterprise Software'), ('ey', 'Financial Services'), ('ey', 'Technology'),
  ('ibm', 'Artificial Intelligence'), ('ibm', 'Cloud Data Platform'), ('ibm', 'Electronics'), ('ibm', 'Gaming'), ('ibm', 'Technology'), ('ibm', 'Telecommunications'),
  ('infosys', 'Artificial Intelligence'), ('infosys', 'Blockchain'), ('infosys', 'Cloud Data Platform'), ('infosys', 'Cybersecurity'), ('infosys', 'Electronics'), ('infosys', 'Technology'), ('infosys', 'Telecommunications'),
  ('meta', 'Artificial Intelligence'), ('meta', 'Blockchain'), ('meta', 'Cloud Data Platform'), ('meta', 'Cybersecurity'), ('meta', 'Electronics'), ('meta', 'Enterprise Software'), ('meta', 'Fintech'), ('meta', 'Gaming'), ('meta', 'Media & Entertainment'), ('meta', 'Retail'), ('meta', 'Technology'), ('meta', 'Telecommunications'),
  ('bmw', 'Airline'), ('bmw', 'Logistics'), ('bmw', 'Manufacturing & Industrial'), ('bmw', 'Technology'),
  ('deloitte', 'Consulting'), ('deloitte', 'Enterprise Software'), ('deloitte', 'Finance'), ('deloitte', 'Financial Services'),
  ('hubspot', 'Cloud Data Platform'), ('hubspot', 'Enterprise Software'), ('hubspot', 'Technology'),
  ('netflix', 'Media & Entertainment'), ('netflix', 'Technology'),
  ('bosch', 'Automotive'), ('bosch', 'Consulting'), ('bosch', 'Cybersecurity'), ('bosch', 'Electronics'), ('bosch', 'FMCG'), ('bosch', 'Logistics'), ('bosch', 'Manufacturing & Industrial'), ('bosch', 'Technology'), ('bosch', 'Telecommunications'),
  ('mckinsey', 'Consulting'), ('mckinsey', 'Finance'), ('mckinsey', 'Financial Services'), ('mckinsey', 'Fintech'), ('mckinsey', 'Technology'),
  ('deutsche telekom', 'Artificial Intelligence'), ('deutsche telekom', 'Cloud Data Platform'), ('deutsche telekom', 'Cybersecurity'), ('deutsche telekom', 'Electronics'), ('deutsche telekom', 'Enterprise Software'), ('deutsche telekom', 'Gaming'), ('deutsche telekom', 'Technology'), ('deutsche telekom', 'Telecommunications'),
  ('hilton', 'Hospitality'), ('hilton', 'Media & Entertainment'), ('hilton', 'Retail'), ('hilton', 'Travel'),
  ('american express', 'Finance'), ('american express', 'Financial Services'), ('american express', 'Fintech'), ('american express', 'Insurance'), ('american express', 'Logistics'), ('american express', 'Travel'),
  ('deel', 'Enterprise Software'), ('deel', 'Finance'), ('deel', 'Financial Services'), ('deel', 'Fintech'), ('deel', 'Insurance'), ('deel', 'Technology'),
  ('kpmg', 'Consulting'), ('kpmg', 'Enterprise Software'), ('kpmg', 'Finance'), ('kpmg', 'Financial Services'), ('kpmg', 'Technology'),
  ('oracle', 'Artificial Intelligence'), ('oracle', 'Cloud Data Platform'), ('oracle', 'Consulting'), ('oracle', 'Enterprise Software'), ('oracle', 'Technology'),
  ('workday', 'Artificial Intelligence'), ('workday', 'Cloud Data Platform'), ('workday', 'Enterprise Software'), ('workday', 'Finance'), ('workday', 'Technology'),
  ('abc consultants', 'Consulting'),
  ('adobe', 'Enterprise Software'), ('adobe', 'Technology'),
  ('airbnb', 'Hospitality'), ('airbnb', 'Technology'), ('airbnb', 'Travel'),
  ('air france', 'Aerospace'), ('air france', 'Airline'), ('air france', 'Travel'),
  ('axis bank', 'Finance'), ('axis bank', 'Financial Services'), ('axis bank', 'Fintech'),
  ('bnp paribas', 'Blockchain'), ('bnp paribas', 'Consulting'), ('bnp paribas', 'Finance'), ('bnp paribas', 'Financial Services'), ('bnp paribas', 'Fintech'), ('bnp paribas', 'Insurance'), ('bnp paribas', 'Technology'),
  ('china mobile', 'Blockchain'), ('china mobile', 'Cybersecurity'), ('china mobile', 'Enterprise Software'), ('china mobile', 'Technology'), ('china mobile', 'Telecommunications'),
  ('cisco', 'Artificial Intelligence'), ('cisco', 'Cloud Data Platform'), ('cisco', 'Consulting'), ('cisco', 'Cybersecurity'), ('cisco', 'Electronics'), ('cisco', 'Enterprise Software'), ('cisco', 'Manufacturing & Industrial'), ('cisco', 'Technology'), ('cisco', 'Telecommunications'),
  ('coca-cola', 'FMCG'), ('coca-cola', 'Logistics'), ('coca-cola', 'Manufacturing & Industrial'), ('coca-cola', 'Retail'),
  ('adidas', 'Apparel'), ('adidas', 'FMCG'), ('adidas', 'Manufacturing & Industrial'), ('adidas', 'Professional Sports'), ('adidas', 'Retail'),
  ('atlassian', 'Artificial Intelligence'), ('atlassian', 'Cloud Data Platform'), ('atlassian', 'Enterprise Software'), ('atlassian', 'Technology'), ('atlassian', 'Telecommunications'),
  ('bain & company', 'Consulting'), ('bain & company', 'Finance'), ('bain & company', 'Financial Services'), ('bain & company', 'FMCG'), ('bain & company', 'Technology'),
  ('bcg', 'Consulting'), ('bcg', 'Finance'), ('bcg', 'Financial Services'),
  ('disney', 'Gaming'), ('disney', 'Hospitality'), ('disney', 'Media & Entertainment'), ('disney', 'Retail'),
  ('lvmh', 'Apparel'), ('lvmh', 'Beauty'), ('lvmh', 'FMCG'), ('lvmh', 'Hospitality'), ('lvmh', 'Manufacturing & Industrial'), ('lvmh', 'Media & Entertainment'), ('lvmh', 'Retail'),
  ('orange', 'Cybersecurity'), ('orange', 'Electronics'), ('orange', 'Media & Entertainment'), ('orange', 'Retail'), ('orange', 'Technology'), ('orange', 'Telecommunications'),
  ('patagonia', 'Apparel'), ('patagonia', 'Beauty'), ('patagonia', 'FMCG'), ('patagonia', 'Manufacturing & Industrial'), ('patagonia', 'Retail'), ('patagonia', 'Travel'),
  ('porsche', 'Airline'), ('porsche', 'Automotive'), ('porsche', 'Logistics'), ('porsche', 'Manufacturing & Industrial'),
  ('procter & gamble', 'Apparel'), ('procter & gamble', 'Beauty'), ('procter & gamble', 'FMCG'), ('procter & gamble', 'Manufacturing & Industrial'), ('procter & gamble', 'Petcare'), ('procter & gamble', 'Retail'),
  -- Forbes: fully blocked (sentinel value)
  ('forbes', '__BLOCKED__'),
  -- Legacy entries
  ('akamai', 'Technology'),
  ('ally', 'Finance'),
  ('apple', 'Retail'), ('apple', 'Media & Entertainment'), ('apple', 'Technology'),
  ('stripe', 'Fintech'),
  ('tesla', 'Automotive'),
  ('unilever', 'Beauty'), ('unilever', 'FMCG'),
  ('united', 'Airline'), ('united', 'Travel'),
  ('upstart', 'Fintech'),
  ('3m', 'Manufacturing'), ('3m', 'Industrial')
ON CONFLICT (company_name, industry_context) DO NOTHING;

-- Create RPC function to return all mappings as a JSON object keyed by company_name
CREATE OR REPLACE FUNCTION public.get_company_industry_mappings()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT json_object_agg(
    company_name,
    industries
  )
  FROM (
    SELECT company_name, json_agg(industry_context ORDER BY industry_context) AS industries
    FROM public.company_industry_mappings
    GROUP BY company_name
  ) sub;
$$;

