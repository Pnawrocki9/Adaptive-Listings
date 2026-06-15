-- Custom Access Token Hook for Estalara Adaptive Listings
--
-- Copies estalara_staff, estalara_role, tenant_id, and agency_role from
-- auth.users.raw_app_meta_data into the JWT so @estalara/auth can read them.
--
-- Setup (one-time, in Supabase dashboard):
--   1. Run this script via the SQL editor to create the function.
--   2. Go to Authentication → Hooks → Custom Access Token.
--   3. Set hook to: public.custom_access_token_hook
--
-- After enabling the hook, all new tokens will carry the custom claims.
-- Existing sessions will get the new claims on next token refresh.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  app_meta jsonb;
BEGIN
  claims := event -> 'claims';
  app_meta := claims -> 'app_metadata';

  -- Staff claims
  IF (app_meta ->> 'estalara_staff') = 'true' THEN
    claims := jsonb_set(claims, '{estalara_staff}', 'true'::jsonb);
    claims := jsonb_set(claims, '{estalara_role}', app_meta -> 'estalara_role');
  END IF;

  -- Tenant (agency) claims
  IF app_meta ->> 'tenant_id' IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', app_meta -> 'tenant_id');
    claims := jsonb_set(claims, '{agency_role}', app_meta -> 'agency_role');
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

-- Grant execute to the Supabase Auth service role
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
