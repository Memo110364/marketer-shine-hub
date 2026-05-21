-- Spend type enum
DO $$ BEGIN
  CREATE TYPE public.ad_spend_type AS ENUM ('meta_ads','tiktok_ads','easy_order','salary','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.ad_spend_transactions
  ADD COLUMN IF NOT EXISTS spend_type public.ad_spend_type NOT NULL DEFAULT 'other';

-- Deduplicate existing fawry_code values (keep oldest) before unique index
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY fawry_code ORDER BY created_at ASC) AS rn
  FROM public.ad_spend_transactions
  WHERE fawry_code IS NOT NULL AND fawry_code <> ''
)
UPDATE public.ad_spend_transactions t
SET fawry_code = NULL
FROM dups
WHERE t.id = dups.id AND dups.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_fawry_code_unique
  ON public.ad_spend_transactions (fawry_code)
  WHERE fawry_code IS NOT NULL AND fawry_code <> '';
