-- AMAIA-SYNC Phase 9.3C v6.3 — 06 RLS plus auth/runtime policies
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- ============================================================
-- 5. RLS POLICIES FOR CUSTOM ROLES
-- ============================================================
-- New tables
alter table public.amaia_sync_domain_identity_policies enable row level security;
alter table public.amaia_sync_manifest_identity_items enable row level security;
alter table public.amaia_sync_dedup_identity_memberships enable row level security;

-- Authenticated (admin/super_admin) — read access
drop policy if exists "dipol_sel_auth" on public.amaia_sync_domain_identity_policies;
create policy "dipol_sel_auth" on public.amaia_sync_domain_identity_policies for select to authenticated using (public.get_user_role((select auth.uid())) in ('admin','super_admin'));
drop policy if exists "mitems_sel_auth" on public.amaia_sync_manifest_identity_items;
create policy "mitems_sel_auth" on public.amaia_sync_manifest_identity_items for select to authenticated using (public.get_user_role((select auth.uid())) in ('admin','super_admin'));
drop policy if exists "membr_sel_auth" on public.amaia_sync_dedup_identity_memberships;
create policy "membr_sel_auth" on public.amaia_sync_dedup_identity_memberships for select to authenticated using (public.get_user_role((select auth.uid())) in ('admin','super_admin'));

-- manifest_owner: full access on tables it needs (SECURITY DEFINER runs as this role)
drop policy if exists "dipol_owner_all" on public.amaia_sync_domain_identity_policies;
create policy "dipol_owner_all" on public.amaia_sync_domain_identity_policies for all to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "mitems_owner_all" on public.amaia_sync_manifest_identity_items;
create policy "mitems_owner_all" on public.amaia_sync_manifest_identity_items for all to amaia_sync_manifest_owner using (true) with check (true);
drop policy if exists "membr_owner_sel" on public.amaia_sync_dedup_identity_memberships;
create policy "membr_owner_sel" on public.amaia_sync_dedup_identity_memberships for select to amaia_sync_manifest_owner using (true);

-- runtime: INSERT manifest (phase=created) + SELECT; INSERT source items + SELECT
drop policy if exists "manifests_rt_ins" on public.amaia_sync_run_manifests;
create policy "manifests_rt_ins" on public.amaia_sync_run_manifests for insert to amaia_sync_runtime with check (true);
drop policy if exists "manifests_rt_sel" on public.amaia_sync_run_manifests;
create policy "manifests_rt_sel" on public.amaia_sync_run_manifests for select to amaia_sync_runtime using (true);
drop policy if exists "mitems_rt_ins" on public.amaia_sync_manifest_identity_items;
create policy "mitems_rt_ins" on public.amaia_sync_manifest_identity_items for insert to amaia_sync_runtime with check (item_role = 'source');
drop policy if exists "mitems_rt_sel" on public.amaia_sync_manifest_identity_items;
create policy "mitems_rt_sel" on public.amaia_sync_manifest_identity_items for select to amaia_sync_runtime using (true);
drop policy if exists "dipol_rt_sel" on public.amaia_sync_domain_identity_policies;
create policy "dipol_rt_sel" on public.amaia_sync_domain_identity_policies for select to amaia_sync_runtime using (true);
