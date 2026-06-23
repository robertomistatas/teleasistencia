-- AMAIA-SYNC Phase 9.3C operational hotfix
-- Qualify pgcrypto digest in the extensions schema while keeping a safe
-- function search_path.

create or replace function public.amaia_sync_compute_set_hash(p_mid uuid, p_role text, p_basis text)
returns table(item_count integer, item_hash text) language plpgsql stable
set search_path = public, pg_catalog
as $f$
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
  item_hash:=encode(extensions.digest(convert_to(array_to_string(v_els,v_delim),'UTF8'),'sha256'),'hex');
  return next;
end; $f$;
alter function public.amaia_sync_compute_set_hash(uuid,text,text) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_compute_set_hash(uuid,text,text) from public;
