-- AMAIA-SYNC Phase 9.3C v6.6 operational hotfix
-- Grants required for SECURITY DEFINER function ownership in schema public.

grant usage on schema public to amaia_sync_manifest_owner;
grant create on schema public to amaia_sync_manifest_owner;

grant usage on schema public to amaia_sync_runtime;
grant usage on schema public to amaia_sync_recovery_runtime;
