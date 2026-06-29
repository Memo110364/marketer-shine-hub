
-- Temporary storage for Meta OAuth exchange between callback and account selection step.
CREATE TABLE public.meta_oauth_sessions (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.meta_oauth_sessions TO service_role;
ALTER TABLE public.meta_oauth_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (server functions / callback) may read/write.

-- Persisted token + metadata on the connected ad account.
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_name TEXT;
