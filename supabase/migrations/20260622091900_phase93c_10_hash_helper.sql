-- AMAIA-SYNC Phase 9.3C v6.3 — 10 identity-aware hash helper
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- ============================================================
-- 7. HELPER (identity-aware hash)
-- ============================================================
-- Hash serialization is identity-basis-aware (Blocker v5-2):
--   source_amaia_id     -> integer_decimal_v1 / sha256_pipe_delimited_sorted
--                          numeric ASC order, elements joined with '|'
--   canonical_dedup_key -> canonical_key_colon_v1 / sha256_colon_delimited_sorted
--                          lexicographic ASC order, elements joined with ':'
create or replace function public.amaia_sync_compute_set_hash(p_mid uuid, p_role text, p_basis text)
returns table(item_count integer, item_hash text) language plpgsql stable as $f$
declare v_els text[]; v_delim text;
begin
  if p_basis='source_amaia_id' then
    v_delim := '|';
    -- Numeric sort: order by the integer column, not its text form (1,2,10 not 1,10,2)
    select array_agg(sub.sid::text order by sub.sid) into v_els
      from (select distinct source_amaia_id as sid from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role=p_role and source_amaia_id is not null) sub;
  elsif p_basis='canonical_dedup_key' then
    v_delim := ':';
    -- Lexicographic sort, colon-delimited per sha256_colon_delimited_sorted
    select array_agg(sub.ck order by sub.ck) into v_els
      from (select distinct canonical_key as ck from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role=p_role and canonical_key is not null) sub;
  else
    raise exception 'unknown identity_basis: %', p_basis;
  end if;
  v_els:=coalesce(v_els,'{}');
  item_count:=coalesce(array_length(v_els,1),0);
  item_hash:=encode(digest(array_to_string(v_els,v_delim),'sha256'),'hex');
  return next;
end; $f$;
alter function public.amaia_sync_compute_set_hash(uuid,text,text) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_compute_set_hash(uuid,text,text) from public;
