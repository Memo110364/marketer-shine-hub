-- "Test Ads" — ad spend the company itself asked the marketer to run as an
-- experiment. It's a real wallet transaction (still recorded and visible in
-- the expenses list), but it must not count as the marketer's accountable
-- ad spend: the company absorbs this cost, so it should not reduce the
-- marketer's net profit or bonus. Split out in its own migration file so the
-- new enum value is committed before the function below references it.
ALTER TYPE public.ad_spend_type ADD VALUE IF NOT EXISTS 'test_ads';
