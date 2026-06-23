-- AMAIA-SYNC Phase 9.3C operational hotfix
-- Allow SECURITY DEFINER helpers owned by manifest_owner to resolve functions
-- in the extensions schema, without widening table/runtime privileges.

grant usage on schema extensions to amaia_sync_manifest_owner;
