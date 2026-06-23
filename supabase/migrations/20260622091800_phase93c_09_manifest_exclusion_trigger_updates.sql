-- AMAIA-SYNC Phase 9.3C v6.3 — 09 manifest and exclusion trigger updates
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- UPDATE #4: manifest phase guard (complete rewrite)
create or replace function public.amaia_sync_manifest_phase_guard() returns trigger as $f$
begin
  if TG_OP='DELETE' then raise exception 'manifests: delete forbidden'; end if;
  if OLD.phase in ('comparison_complete','abandoned') then raise exception 'terminal phase'; end if;
  if NEW.phase is distinct from OLD.phase and current_user is distinct from 'amaia_sync_manifest_owner' then raise exception 'phase requires manifest_owner (got %)', current_user; end if;
  if NEW.id is distinct from OLD.id or NEW.run_id is distinct from OLD.run_id or NEW.domain_name is distinct from OLD.domain_name or NEW.identity_basis is distinct from OLD.identity_basis or NEW.identity_version is distinct from OLD.identity_version or NEW.canonicalization_version is distinct from OLD.canonicalization_version or NEW.hash_algorithm is distinct from OLD.hash_algorithm or NEW.serialization_version is distinct from OLD.serialization_version or NEW.raw_max_id is distinct from OLD.raw_max_id or NEW.created_at is distinct from OLD.created_at then raise exception 'immutable column'; end if;
  if NEW.phase is not distinct from OLD.phase then raise exception 'must advance phase'; end if;
  if OLD.phase='created' and NEW.phase='source_fetched' then if NEW.source_id_count is null or NEW.source_id_hash is null then raise exception 'source_fetched needs count+hash'; end if; return NEW; end if;
  if OLD.phase='source_fetched' and NEW.phase='confirmed_compared' then if NEW.persisted_id_count is null or NEW.persisted_id_hash is null or NEW.sets_match is null or NEW.verified_at is null then raise exception 'confirmed needs evidence'; end if; return NEW; end if;
  if OLD.phase='confirmed_compared' and NEW.phase='provisional_persisted' then return NEW; end if;
  if NEW.phase='comparison_complete' and OLD.phase in ('confirmed_compared','provisional_persisted') then if OLD.phase='provisional_persisted' and NEW.provisional_verified is distinct from true then raise exception 'provisional_verified must be true'; end if; return NEW; end if;
  if NEW.phase='abandoned' then if NEW.abandoned_by is null or NEW.abandoned_at is null or NEW.abandoned_reason is null or length(NEW.abandoned_reason)=0 then raise exception 'abandoned needs evidence'; end if; return NEW; end if;
  raise exception 'invalid: %->%', OLD.phase, NEW.phase;
end; $f$ language plpgsql;

-- UPDATE #6: excl inv guard (canonical + subject FOR UPDATE)
create or replace function public.amaia_sync_excl_inv_guard() returns trigger as $f$
declare v_dom text; v_aid integer; v_ck text;
begin
  if TG_OP='UPDATE' then raise exception 'append-only'; end if;
  if TG_OP='DELETE' then raise exception 'append-only'; end if;
  if TG_OP='INSERT' then
    -- Lock subject to serialize investigation creation
    select domain_name, excluded_amaia_id, excluded_canonical_key into v_dom, v_aid, v_ck
      from public.amaia_sync_manifest_exclusion_subjects where id=NEW.subject_id for update;
    if not found then raise exception 'subject not found'; end if;
    if v_dom is distinct from NEW.domain_name then raise exception 'domain mismatch'; end if;
    if NEW.excluded_amaia_id is distinct from v_aid then raise exception 'excluded_amaia_id mismatch'; end if;
    if NEW.excluded_canonical_key is distinct from v_ck then raise exception 'excluded_canonical_key mismatch'; end if;
    return NEW;
  end if;
  return null;
end; $f$ language plpgsql;

-- UPDATE #9: excl subject progression (canonical + policy + closed domain)
create or replace function public.amaia_sync_excl_subject_progression_guard() returns trigger as $f$
declare v_iseq integer; v_pol_basis text;
begin
  if TG_OP='INSERT' then
    if NEW.current_investigation_id is not null then raise exception 'new subject: no investigation'; end if;
    if NEW.current_investigation_seq is distinct from 0 then raise exception 'new subject: seq=0'; end if;
    select required_identity_basis into v_pol_basis from public.amaia_sync_domain_identity_policies where domain_name=NEW.domain_name;
    if not found then raise exception 'no policy for domain %', NEW.domain_name; end if;
    if v_pol_basis='source_amaia_id' and (NEW.excluded_amaia_id is null or NEW.excluded_canonical_key is not null) then raise exception 'source domain requires excluded_amaia_id'; end if;
    if v_pol_basis='canonical_dedup_key' and (NEW.excluded_canonical_key is null or NEW.excluded_amaia_id is not null) then raise exception 'dedup domain requires excluded_canonical_key'; end if;
    return NEW;
  end if;
  if TG_OP='UPDATE' then
    if NEW.domain_name is distinct from OLD.domain_name or NEW.excluded_amaia_id is distinct from OLD.excluded_amaia_id or NEW.excluded_canonical_key is distinct from OLD.excluded_canonical_key or NEW.created_at is distinct from OLD.created_at then raise exception 'immutable'; end if;
    if OLD.current_investigation_id is not null and NEW.current_investigation_id is null then raise exception 'cannot clear investigation'; end if;
    if NEW.current_investigation_seq<OLD.current_investigation_seq then raise exception 'seq cannot decrease'; end if;
    if NEW.current_investigation_id is distinct from OLD.current_investigation_id then
      if NEW.current_investigation_seq is distinct from OLD.current_investigation_seq+1 then raise exception 'seq must be +1'; end if;
      select investigation_seq into v_iseq from public.amaia_sync_manifest_exclusion_investigations where id=NEW.current_investigation_id and subject_id=NEW.id;
      if v_iseq is null then raise exception 'investigation not found for subject'; end if;
      if v_iseq is distinct from NEW.current_investigation_seq then raise exception 'inv seq mismatch'; end if;
    else
      if NEW.current_investigation_seq is distinct from OLD.current_investigation_seq then raise exception 'seq without inv change'; end if;
    end if;
    NEW.updated_at:=now(); return NEW;
  end if;
  return null;
end; $f$ language plpgsql;
