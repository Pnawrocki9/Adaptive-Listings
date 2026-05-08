-- Supabase custom JWT claims hook
-- Install via: Supabase Dashboard → Authentication → Hooks → Custom Access Token
-- This function runs on every token mint/refresh and injects our custom claims.
--
-- IMPORTANT: The hook must be registered in the Supabase dashboard, not just defined.
-- After creating the function, go to:
--   Authentication → Hooks → Custom Access Token Hook → Select function: custom_access_token_hook
--
-- Reference: https://supabase.com/docs/guides/auth/auth-hooks#custom-access-token-hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_row record;
BEGIN
  -- Fetch user record from our users table using Supabase auth user_id
  SELECT
    tenant_id,
    agency_role,
    estalara_staff,
    estalara_role,
    mfa_enabled
  INTO user_row
  FROM public.users
  WHERE id = (event ->> 'user_id')::uuid;

  -- Start from existing claims (includes Supabase standard fields like sub, email, role)
  claims := event -> 'claims';

  IF user_row IS NOT NULL THEN
    -- Agency user path: has a tenant_id, not Estalara staff
    IF user_row.tenant_id IS NOT NULL AND NOT user_row.estalara_staff THEN
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_row.tenant_id::text));
      claims := jsonb_set(claims, '{agency_role}', to_jsonb(user_row.agency_role));
      claims := jsonb_set(claims, '{estalara_staff}', 'false'::jsonb);
    END IF;

    -- Estalara staff path: estalara_staff = true, no tenant affiliation
    IF user_row.estalara_staff THEN
      claims := jsonb_set(claims, '{estalara_staff}', 'true'::jsonb);
      claims := jsonb_set(claims, '{estalara_role}', to_jsonb(user_row.estalara_role));
      claims := jsonb_set(claims, '{tenant_id}', 'null'::jsonb);
    END IF;

    -- MFA status — propagate so middleware can enforce step-up auth
    claims := jsonb_set(claims, '{mfa_verified}', to_jsonb(user_row.mfa_enabled));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Security: only supabase_auth_admin may execute this function
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC, anon, authenticated;
