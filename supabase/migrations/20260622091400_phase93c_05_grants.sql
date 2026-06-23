-- AMAIA-SYNC Phase 9.3C v6.3 — 05 grants
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- 4. GRANTS
-- ============================================================
grant select, update on public.amaia_sync_run_manifests to amaia_sync_manifest_owner;
grant select, insert on public.amaia_sync_manifest_identity_items to amaia_sync_manifest_owner;
grant select, update on public.amaia_sync_leases to amaia_sync_manifest_owner;
grant select, update on public.amaia_sync_runs to amaia_sync_manifest_owner;
grant select on public.amaia_sync_domain_identity_policies to amaia_sync_manifest_owner;
grant select, update, insert on public.amaia_sync_manifest_exclusion_subjects to amaia_sync_manifest_owner;
grant select on public.amaia_sync_manifest_exclusion_investigations to amaia_sync_manifest_owner;
grant select on public.amaia_sync_manifest_exclusion_decisions to amaia_sync_manifest_owner;
grant insert on public.amaia_sync_manifest_exclusion_consumptions to amaia_sync_manifest_owner;
grant select, update on public.amaia_sync_watermarks to amaia_sync_manifest_owner;
grant select on public.amaia_beneficiaries to amaia_sync_manifest_owner;
grant select on public.amaia_support_network to amaia_sync_manifest_owner;
grant select on public.amaia_alerts to amaia_sync_manifest_owner;
grant select on public.amaia_call_logs to amaia_sync_manifest_owner;
grant select on public.amaia_alert_logs to amaia_sync_manifest_owner;
grant select on public.amaia_health_conditions to amaia_sync_manifest_owner;
grant select on public.amaia_medications to amaia_sync_manifest_owner;
grant select on public.amaia_sync_dedup_identity_memberships to amaia_sync_manifest_owner;
grant insert, select on public.amaia_sync_run_manifests to amaia_sync_runtime;
grant insert, select on public.amaia_sync_manifest_identity_items to amaia_sync_runtime;
grant select on public.amaia_sync_domain_identity_policies to amaia_sync_runtime;
grant select on public.amaia_sync_run_manifests to amaia_sync_recovery_runtime;
