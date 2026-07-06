-- Local/self-host fix: newer Supabase CLI versions don't implicitly grant
-- service_role access to public schema tables, causing 42501 (permission
-- denied) on first sign-in. Grant explicitly, incl. future tables.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
