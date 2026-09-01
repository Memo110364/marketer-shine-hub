-- Add 'in_progress' (جاري الاختبار) to the test result states.
--
-- Widening the CHECK only ever accepts more values, so every existing row
-- stays valid — the 7 migrated historical rows carry result = NULL and are
-- untouched. Nothing about test spend accounting changes here.
ALTER TABLE public.test_spend_entries
  DROP CONSTRAINT IF EXISTS test_spend_entries_result_check;

ALTER TABLE public.test_spend_entries
  ADD CONSTRAINT test_spend_entries_result_check
  CHECK (result IN ('in_progress', 'successful', 'promising', 'weak', 'discontinued'));
