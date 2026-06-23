-- AMAIA-SYNC Phase 9.3C v6.3 — 15 seeds
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- ============================================================
-- 10. SEEDS
-- ============================================================
insert into public.amaia_sync_domain_identity_policies(domain_name,required_identity_basis,required_identity_version,required_canonicalization_version,required_hash_algorithm,required_serialization_version)
values ('beneficiario','source_amaia_id','source_id_v1',null,'sha256_pipe_delimited_sorted','integer_decimal_v1'),
  ('red','source_amaia_id','source_id_v1',null,'sha256_pipe_delimited_sorted','integer_decimal_v1'),
  ('control_llamadas','source_amaia_id','source_id_v1',null,'sha256_pipe_delimited_sorted','integer_decimal_v1'),
  ('logestado','source_amaia_id','source_id_v1',null,'sha256_pipe_delimited_sorted','integer_decimal_v1'),
  ('alerta','source_amaia_id','source_id_v1',null,'sha256_pipe_delimited_sorted','integer_decimal_v1'),
  ('enfermedades','canonical_dedup_key','dedup_key_v1','canonicalization_v1','sha256_colon_delimited_sorted','canonical_key_colon_v1'),
  ('medicamentos','canonical_dedup_key','dedup_key_v1','canonicalization_v1','sha256_colon_delimited_sorted','canonical_key_colon_v1')
on conflict do nothing;

insert into public.amaia_sync_watermarks(entity_name,source_table,watermark_type,last_id,last_timestamp) values ('enfermedades','beneficiario_enfermedad','id',0,null),('medicamentos','beneficiario_medicamento','id',0,null) on conflict do nothing;
insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token) values ('scheduler',null,0) on conflict do nothing;
