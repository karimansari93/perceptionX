-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260316082038; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix acronym casing in company_canonical_names (both canonical_name and variant_name)
UPDATE company_canonical_names SET canonical_name = REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  canonical_name,
  '\mHca\M', 'HCA', 'g'),
  '\mIbm\M', 'IBM', 'g'),
  '\mBmw\M', 'BMW', 'g'),
  '\mGe\M', 'GE', 'g'),
  '\mGsk\M', 'GSK', 'g'),
  '\mHsbc\M', 'HSBC', 'g'),
  '\mUbs\M', 'UBS', 'g'),
  '\mSap\M', 'SAP', 'g'),
  '\mDhl\M', 'DHL', 'g'),
  '\mAws\M', 'AWS', 'g'),
  '\mKpmg\M', 'KPMG', 'g'),
  '\mPwc\M', 'PwC', 'g'),
  '\mUps\M', 'UPS', 'g'),
  '\mAig\M', 'AIG', 'g'),
  '\mBnp\M', 'BNP', 'g'),
  '\mGm\M', 'GM', 'g'),
  updated_at = NOW()
WHERE canonical_name ~* '\mHca\M|\mIbm\M|\mBmw\M|\mGe\M|\mGsk\M|\mHsbc\M|\mUbs\M|\mSap\M|\mDhl\M|\mAws\M|\mKpmg\M|\mPwc\M|\mUps\M|\mAig\M|\mBnp\M|\mGm\M';

-- Also fix variant_name
UPDATE company_canonical_names SET variant_name = REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  variant_name,
  '\mHca\M', 'HCA', 'g'),
  '\mIbm\M', 'IBM', 'g'),
  '\mBmw\M', 'BMW', 'g'),
  '\mGe\M', 'GE', 'g'),
  '\mGsk\M', 'GSK', 'g'),
  '\mHsbc\M', 'HSBC', 'g'),
  '\mUbs\M', 'UBS', 'g'),
  '\mSap\M', 'SAP', 'g'),
  '\mDhl\M', 'DHL', 'g'),
  '\mAws\M', 'AWS', 'g'),
  '\mKpmg\M', 'KPMG', 'g'),
  '\mPwc\M', 'PwC', 'g'),
  '\mUps\M', 'UPS', 'g'),
  '\mAig\M', 'AIG', 'g'),
  '\mBnp\M', 'BNP', 'g'),
  '\mGm\M', 'GM', 'g'),
  updated_at = NOW()
WHERE variant_name ~* '\mHca\M|\mIbm\M|\mBmw\M|\mGe\M|\mGsk\M|\mHsbc\M|\mUbs\M|\mSap\M|\mDhl\M|\mAws\M|\mKpmg\M|\mPwc\M|\mUps\M|\mAig\M|\mBnp\M|\mGm\M';

