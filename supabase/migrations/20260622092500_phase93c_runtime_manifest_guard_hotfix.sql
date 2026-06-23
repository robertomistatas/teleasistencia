-- AMAIA-SYNC Phase 9.3C operational hotfix
-- Make identity-items trigger guard execute as manifest_owner so its manifest
-- phase/basis read with FOR SHARE is not blocked under amaia_sync_runtime.
-- Runtime privileges are not widened: runtime still has no UPDATE on manifests
-- and RLS still only allows runtime source item inserts.

create or replace function public.amaia_sync_identity_items_guard() returns trigger
security definer
set search_path = public, pg_catalog
as $f$
declare v_phase text; v_basis text;
begin
  if TG_OP in ('UPDATE','DELETE') then raise exception 'identity_items: % forbidden', TG_OP; end if;
  select phase, identity_basis into v_phase, v_basis from public.amaia_sync_run_manifests where id=NEW.manifest_id for share;
  if not found then raise exception 'manifest not found'; end if;
  if NEW.identity_basis is distinct from v_basis then raise exception 'basis mismatch'; end if;
  if v_phase='created' and NEW.item_role='source' then return NEW; end if;
  if v_phase='source_fetched' and NEW.item_role in ('persisted','missing','extra','excluded') then
    if current_user is distinct from 'amaia_sync_manifest_owner' then raise exception 'derived items require manifest_owner (got %)', current_user; end if;
    return NEW;
  end if;
  raise exception 'role % not allowed at phase %', NEW.item_role, v_phase;
end;
$f$ language plpgsql;

alter function public.amaia_sync_identity_items_guard() owner to amaia_sync_manifest_owner;
revoke all on function public.amaia_sync_identity_items_guard() from public;
