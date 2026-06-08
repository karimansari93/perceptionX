-- =============================================================================
-- Entity canonicalization
--
-- Adds three tables + a normalization function so the same company
-- appearing under many variants in prompt_responses.detected_competitors
-- (e.g. "Hyundai", "Hyundai Motor India", "Hyundai India") can collapse
-- into a single canonical entity in the share-of-voice MV.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Normalization function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_entity_name(input_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(
        TRIM(BOTH FROM
            -- collapse internal whitespace
            REGEXP_REPLACE(
                -- strip leading/trailing punctuation and quotes
                REGEXP_REPLACE(
                    -- replace ampersand with " and "
                    REPLACE(
                        LOWER(COALESCE(input_name, '')),
                        '&', ' and '
                    ),
                    '(^[[:punct:][:space:]"]+|[[:punct:][:space:]"]+$)',
                    '',
                    'g'
                ),
                '[[:space:]]+',
                ' ',
                'g'
            )
        ),
        ''
    );
$$;

COMMENT ON FUNCTION public.normalize_entity_name(text) IS
    'Canonical lookup key for entity names. Lowercase, trims, collapses whitespace, replaces & with and, strips edge punctuation. Used for alias dedupe.';


-- -----------------------------------------------------------------------------
-- 2. canonical_entities
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_entities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name text NOT NULL UNIQUE,
    normalized_name text NOT NULL UNIQUE,
    entity_type text,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_entities_active_idx
    ON public.canonical_entities (is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS canonical_entities_type_idx
    ON public.canonical_entities (entity_type);

CREATE OR REPLACE FUNCTION public.canonical_entities_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_entities_set_updated_at ON public.canonical_entities;
CREATE TRIGGER canonical_entities_set_updated_at
    BEFORE UPDATE ON public.canonical_entities
    FOR EACH ROW EXECUTE FUNCTION public.canonical_entities_touch_updated_at();


-- -----------------------------------------------------------------------------
-- 3. entity_aliases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entity_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_id uuid NOT NULL REFERENCES public.canonical_entities(id) ON DELETE CASCADE,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    source text NOT NULL DEFAULT 'admin_manual',
    approved_by uuid,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_aliases_normalized_unique_idx
    ON public.entity_aliases (normalized_alias);

CREATE INDEX IF NOT EXISTS entity_aliases_canonical_idx
    ON public.entity_aliases (canonical_id);


-- -----------------------------------------------------------------------------
-- 4. entity_alias_suggestions  (LLM review queue)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entity_alias_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_alias text NOT NULL,
    normalized_alias text NOT NULL UNIQUE,
    mention_count int NOT NULL DEFAULT 0,
    suggested_canonical_name text,
    suggested_entity_type text,
    suggested_is_non_entity boolean NOT NULL DEFAULT false,
    confidence numeric,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'merged_into_existing')),
    resolved_canonical_id uuid REFERENCES public.canonical_entities(id) ON DELETE SET NULL,
    llm_rationale text,
    llm_model text,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid
);

CREATE INDEX IF NOT EXISTS entity_alias_suggestions_status_idx
    ON public.entity_alias_suggestions (status, mention_count DESC);


-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.canonical_entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_aliases           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_alias_suggestions ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; we expose read+write to admins only.
-- Admins are identified the same way as elsewhere in the codebase: via the
-- is_admin() helper if it exists, otherwise fall back to service-role-only.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_admin'
    ) THEN
        EXECUTE 'CREATE POLICY canonical_entities_admin ON public.canonical_entities
                 FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
        EXECUTE 'CREATE POLICY entity_aliases_admin ON public.entity_aliases
                 FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
        EXECUTE 'CREATE POLICY entity_alias_suggestions_admin ON public.entity_alias_suggestions
                 FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
    END IF;
END $$;

-- Authenticated users can READ canonical entities + aliases (needed for the
-- competitors MV join visibility / debugging UIs); writes stay admin-only.
DROP POLICY IF EXISTS canonical_entities_read ON public.canonical_entities;
CREATE POLICY canonical_entities_read ON public.canonical_entities
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS entity_aliases_read ON public.entity_aliases;
CREATE POLICY entity_aliases_read ON public.entity_aliases
    FOR SELECT TO authenticated USING (true);


-- -----------------------------------------------------------------------------
-- 6. Seed canonical entities for the obvious top variants
--    Based on the share-of-voice list the admin reviewed: Tata Motors, Hyundai,
--    Maruti Suzuki, Mahindra, Toyota, Mercedes-Benz, Bosch, Renault-Nissan,
--    plus their visible variants.
-- -----------------------------------------------------------------------------
WITH seed(canonical_name, entity_type, aliases) AS (
    VALUES
    ('Tata Motors',        'oem',         ARRAY['Tata Motors', 'Tata', 'Tata Motors Finance']),
    ('Hyundai',            'oem',         ARRAY['Hyundai', 'Hyundai Motor India', 'Hyundai India', 'Hyundai Motor', 'Hyundai Motors']),
    ('Maruti Suzuki',      'oem',         ARRAY['Maruti Suzuki', 'Maruti', 'Maruti-Suzuki', 'Maruti Suzuki India']),
    ('Mahindra',           'oem',         ARRAY['Mahindra', 'Mahindra & Mahindra', 'Mahindra and Mahindra']),
    ('Toyota',             'oem',         ARRAY['Toyota', 'Toyota Kirloskar', 'Toyota Kirloskar Motor']),
    ('Mercedes-Benz',      'oem',         ARRAY['Mercedes-Benz', 'Mercedes', 'Mercedes-Benz Research', 'Mercedes-Benz R&D India', 'Mercedes-Benz Mobility']),
    ('Volkswagen',         'oem',         ARRAY['Volkswagen', 'Volkswagen Group', 'Volkswagen Financial Services']),
    ('General Motors',     'oem',         ARRAY['General Motors', 'GM', 'GM Financial']),
    ('Honda',              'oem',         ARRAY['Honda', 'Honda Cars', 'Honda Finance']),
    ('Bosch',              'supplier',    ARRAY['Bosch', 'Bosch India', 'Bosch Global Software', 'Bosch Group', 'Bosch Digital', 'Bosch India (ET)']),
    ('Tesla',              'oem',         ARRAY['Tesla', 'Tesla India']),
    ('Nissan',             'oem',         ARRAY['Nissan']),
    ('BMW',                'oem',         ARRAY['BMW']),
    ('Kia',                'oem',         ARRAY['Kia', 'Kia India', 'Hyundai-Kia', 'Hyundai Kia']),
    ('Suzuki',             'oem',         ARRAY['Suzuki', 'Tata Suzuki']),
    ('Renault-Nissan',     'oem',         ARRAY['Renault-Nissan', 'Renault Nissan', 'Renault Nissan Alliance', 'Renault-Nissan Alliance', 'Renault-Nissan Technology']),
    ('Stellantis',         'oem',         ARRAY['Stellantis', 'Stellantis India']),
    ('Ford',               'non_entity',  ARRAY['"Ford" Does Not', 'Ford Motor Company']),
    ('Hyundai Mobis',      'supplier',    ARRAY['Hyundai Mobis', 'Hyundai Mobis India']),
    ('Continental',        'supplier',    ARRAY['Continental']),
    ('Volvo',              'oem',         ARRAY['Volvo', 'Volvo Group', 'Volvo Tech']),
    ('Ola Electric',       'oem',         ARRAY['Ola Electric']),
    ('Ather Energy',       'oem',         ARRAY['Ather', 'Ather Energy']),
    ('Tata Technologies',  'it_services', ARRAY['Tata Technologies']),
    ('Tata Elxsi',         'it_services', ARRAY['Tata Elxsi']),
    ('KPIT',               'it_services', ARRAY['KPIT']),
    ('Infosys',            'it_services', ARRAY['Infosys']),
    ('TCS',                'it_services', ARRAY['TCS']),
    ('Wipro',              'it_services', ARRAY['Wipro']),
    ('HCL',                'it_services', ARRAY['HCL']),
    ('Tech Mahindra',      'it_services', ARRAY['Tech Mahindra', 'Mahindra IT']),
    ('Accenture',          'it_services', ARRAY['Accenture']),
    ('Capgemini',          'it_services', ARRAY['Capgemini']),
    ('Deloitte',           'consulting',  ARRAY['Deloitte']),
    ('KPMG',               'consulting',  ARRAY['KPMG']),
    ('Mahindra Financial', 'financial',   ARRAY['Mahindra Financial', 'Mahindra Finance']),
    ('Cholamandalam',      'financial',   ARRAY['Cholamandalam']),
    ('HDFC Bank',          'financial',   ARRAY['HDFC Bank', 'HDFC', 'HDFC Bank Auto Loans']),
    ('ICICI',              'financial',   ARRAY['ICICI']),
    ('Bajaj Finance',      'financial',   ARRAY['Bajaj Finance']),
    ('Axis Bank',          'financial',   ARRAY['Axis Bank']),
    ('Toyota Financial Services', 'financial', ARRAY['Toyota Financial Services', 'Toyota Financial']),
    ('Hyundai Capital',    'financial',   ARRAY['Hyundai Capital', 'Hyundai Finance']),
    ('Honda Finance',      'financial',   ARRAY['Honda Finance']),
    ('Hero MotoCorp',      'oem',         ARRAY['Hero MotoCorp']),
    ('MG Motor India',     'oem',         ARRAY['MG Motor India']),
    ('Royal Enfield',      'oem',         ARRAY['Royal Enfield']),
    ('TVS',                'oem',         ARRAY['TVS']),
    ('Ashok Leyland',      'oem',         ARRAY['Ashok Leyland']),
    ('VinFast',            'oem',         ARRAY['VinFast']),
    ('BYD',                'oem',         ARRAY['BYD']),
    ('Rivian',             'oem',         ARRAY['Rivian']),
    ('Harley-Davidson',    'oem',         ARRAY['Harley-Davidson']),
    ('Audi',               'oem',         ARRAY['Audi']),
    ('Chevrolet',          'oem',         ARRAY['Chevrolet']),
    ('Chrysler',           'oem',         ARRAY['Chrysler']),
    ('Changan',            'oem',         ARRAY['Changan']),
    -- non-entities that leaked into the SOV list and should disappear
    ('__non_entity_north_america',         'non_entity', ARRAY['North America']),
    ('__non_entity_no_competitors',        'non_entity', ARRAY['No Competitors', 'No Competitors Found']),
    ('__non_entity_indian_firms',          'non_entity', ARRAY['Indian Firms']),
    ('__non_entity_ev_startups',           'non_entity', ARRAY['EV Startups']),
    ('__non_entity_indian_automotive',     'non_entity', ARRAY['Indian Automotive', 'Indian Automotive Industry']),
    ('__non_entity_automotive_peers',      'non_entity', ARRAY['Automotive Peers', 'Automotive Players']),
    ('__non_entity_management_consulting', 'non_entity', ARRAY['Management Consulting']),
    ('__non_entity_general_tech',          'non_entity', ARRAY['General Tech/Cars', 'General Tech']),
    ('__non_entity_glassdoor_phrase',      'non_entity', ARRAY[E'Glassdoor''s Forum', 'Glassdoor Forum']),
    ('__non_entity_automotive_robotics',   'non_entity', ARRAY['Automotive Robotics']),
    ('__non_entity_global_automotive',     'non_entity', ARRAY['Global Automotive']),
    ('__non_entity_automotive_mfg',        'non_entity', ARRAY['Automotive Manufacturers', 'Automotive Manufacturing']),
    ('__non_entity_renault_nissan_phrase', 'non_entity', ARRAY['Renault-Nissan Alliance Tech'])
),
inserted_canonicals AS (
    INSERT INTO public.canonical_entities (canonical_name, normalized_name, entity_type, is_active)
    SELECT
        s.canonical_name,
        public.normalize_entity_name(s.canonical_name),
        s.entity_type,
        s.entity_type IS DISTINCT FROM 'non_entity'
    FROM seed s
    ON CONFLICT (canonical_name) DO UPDATE
        SET entity_type = EXCLUDED.entity_type,
            is_active   = EXCLUDED.is_active
    RETURNING id, canonical_name
)
INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
SELECT
    ic.id,
    alias_value,
    public.normalize_entity_name(alias_value),
    'admin_manual',
    now()
FROM inserted_canonicals ic
JOIN seed s ON s.canonical_name = ic.canonical_name
CROSS JOIN LATERAL UNNEST(s.aliases) AS alias_value
WHERE public.normalize_entity_name(alias_value) IS NOT NULL
ON CONFLICT (normalized_alias) DO NOTHING;
