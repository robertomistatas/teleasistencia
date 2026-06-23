-- AMAIA-SYNC Phase 9.3C v6.3 — 07 owner, destination, recovery policies
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- manifest_owner on existing RLS tables it accesses via finalizers
-- These tables already have RLS enabled from 9.3B. We add policies for manifest_owner.
drop policy if exists "manifests_owner_all" on public.amaia_sync_run_manifests;
create policy "manifests_owner_all" on public.amaia_sync_run_manifests for all to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "runs_owner_sel" on public.amaia_sync_runs;
create policy "runs_owner_sel" on public.amaia_sync_runs for select to amaia_sync_manifest_owner using (true);
drop policy if exists "runs_owner_upd" on public.amaia_sync_runs;
create policy "runs_owner_upd" on public.amaia_sync_runs for update to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "leases_owner_sel" on public.amaia_sync_leases;
create policy "leases_owner_sel" on public.amaia_sync_leases for select to amaia_sync_manifest_owner using (true);
drop policy if exists "leases_owner_upd" on public.amaia_sync_leases;
create policy "leases_owner_upd" on public.amaia_sync_leases for update to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "wmarks_owner_sel" on public.amaia_sync_watermarks;
create policy "wmarks_owner_sel" on public.amaia_sync_watermarks for select to amaia_sync_manifest_owner using (true);
drop policy if exists "wmarks_owner_upd" on public.amaia_sync_watermarks;
create policy "wmarks_owner_upd" on public.amaia_sync_watermarks for update to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "excl_subj_owner_all" on public.amaia_sync_manifest_exclusion_subjects;
create policy "excl_subj_owner_all" on public.amaia_sync_manifest_exclusion_subjects for all to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "excl_inv_owner_sel" on public.amaia_sync_manifest_exclusion_investigations;
create policy "excl_inv_owner_sel" on public.amaia_sync_manifest_exclusion_investigations for select to amaia_sync_manifest_owner using (true);
drop policy if exists "excl_dec_owner_sel" on public.amaia_sync_manifest_exclusion_decisions;
create policy "excl_dec_owner_sel" on public.amaia_sync_manifest_exclusion_decisions for select to amaia_sync_manifest_owner using (true);
drop policy if exists "excl_con_owner_ins" on public.amaia_sync_manifest_exclusion_consumptions;
create policy "excl_con_owner_ins" on public.amaia_sync_manifest_exclusion_consumptions for insert to amaia_sync_manifest_owner with check (true);
-- Destination tables for P_check (already have RLS from 9.3B; add owner policies)
drop policy if exists "ben_owner_sel" on public.amaia_beneficiaries;
create policy "ben_owner_sel" on public.amaia_beneficiaries for select to amaia_sync_manifest_owner using (true);
drop policy if exists "red_owner_sel" on public.amaia_support_network;
create policy "red_owner_sel" on public.amaia_support_network for select to amaia_sync_manifest_owner using (true);
drop policy if exists "alerts_owner_sel" on public.amaia_alerts;
create policy "alerts_owner_sel" on public.amaia_alerts for select to amaia_sync_manifest_owner using (true);
drop policy if exists "calls_owner_sel" on public.amaia_call_logs;
create policy "calls_owner_sel" on public.amaia_call_logs for select to amaia_sync_manifest_owner using (true);
drop policy if exists "alogs_owner_sel" on public.amaia_alert_logs;
create policy "alogs_owner_sel" on public.amaia_alert_logs for select to amaia_sync_manifest_owner using (true);
drop policy if exists "hcond_owner_sel" on public.amaia_health_conditions;
create policy "hcond_owner_sel" on public.amaia_health_conditions for select to amaia_sync_manifest_owner using (true);
drop policy if exists "meds_owner_sel" on public.amaia_medications;
create policy "meds_owner_sel" on public.amaia_medications for select to amaia_sync_manifest_owner using (true);

-- recovery: SELECT manifests for abandon
drop policy if exists "manifests_recov_sel" on public.amaia_sync_run_manifests;
create policy "manifests_recov_sel" on public.amaia_sync_run_manifests for select to amaia_sync_recovery_runtime using (true);
-- recovery needs access to leases/runs for abandon lock order
drop policy if exists "runs_recov_sel" on public.amaia_sync_runs;
create policy "runs_recov_sel" on public.amaia_sync_runs for select to amaia_sync_recovery_runtime using (true);
drop policy if exists "runs_recov_upd" on public.amaia_sync_runs;
create policy "runs_recov_upd" on public.amaia_sync_runs for update to amaia_sync_recovery_runtime using (true) with check (true);
drop policy if exists "leases_recov_sel" on public.amaia_sync_leases;
create policy "leases_recov_sel" on public.amaia_sync_leases for select to amaia_sync_recovery_runtime using (true);
drop policy if exists "leases_recov_upd" on public.amaia_sync_leases;
create policy "leases_recov_upd" on public.amaia_sync_leases for update to amaia_sync_recovery_runtime using (true) with check (true);
