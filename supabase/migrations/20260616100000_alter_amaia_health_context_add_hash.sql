-- AMAIA-SYNC
-- Migration 015
-- Extend amaia_health_conditions and amaia_medications with source_id,
-- canonical_text, hash_version and hash. Deduplication key is the hash,
-- not source_id: 9.1D (V-005) found beneficiaries with the same
-- condition/medication entered twice in AMAIA under two distinct source
-- rows (e.g. "Diabetes" x2) — deduplicating by source_id would keep both
-- as separate synced rows, defeating the purpose. source_id is kept only
-- as a traceability pointer back to the originating AMAIA row, not as
-- part of the uniqueness key.
--
-- idx_amaia_health_conditions_beneficiary_amaia_id and
-- idx_amaia_medications_beneficiary_amaia_id already exist from the
-- original migration (20260615125000) — no duplicate index is created
-- here.
--
-- canonical_text/hash_version/hash are NOT NULL with no default. This is
-- safe: both tables were confirmed empty (0 rows) before writing this
-- migration. It is also the correct enforcement of the 9.1C rule that a
-- row whose canonicalization result is empty is never inserted at all —
-- there is no valid state for a synced row to exist without a hash, so
-- the database should reject that case outright rather than rely on a
-- partial unique index to tolerate it.

alter table public.amaia_health_conditions
  add column if not exists source_id integer,
  add column if not exists canonical_text text not null,
  add column if not exists hash_version text not null,
  add column if not exists hash text not null;

alter table public.amaia_medications
  add column if not exists source_id integer,
  add column if not exists canonical_text text not null,
  add column if not exists hash_version text not null,
  add column if not exists hash text not null;

create unique index if not exists idx_amaia_health_conditions_dedup
  on public.amaia_health_conditions (beneficiary_amaia_id, hash, hash_version);

create unique index if not exists idx_amaia_medications_dedup
  on public.amaia_medications (beneficiary_amaia_id, hash, hash_version);

comment on column public.amaia_health_conditions.source_id
  is 'beneficiario_enfermedad.id from AMAIA. Traceability pointer only — NOT part of the deduplication key, since two distinct source_id values can legitimately collapse to the same canonical_text/hash for the same beneficiary.';

comment on column public.amaia_health_conditions.canonical_text
  is 'Result of deterministic canonicalization (trim, whitespace collapse, case, diacritics) applied to condition_original. No automatic semantic correction is ever applied (e.g. "ASTORVACTATINA" is never auto-corrected to "ATORVASTATINA").';

comment on column public.amaia_health_conditions.hash_version
  is 'Version tag of the canonicalization algorithm used to produce hash (e.g. "canonicalization_v1"). Required so a future algorithm change does not silently collide old and new hashes for the same text.';

comment on column public.amaia_health_conditions.hash
  is 'Deterministic hash of (beneficiary_amaia_id + canonical_text) under hash_version. NOT NULL by design: a row with empty canonicalization is never inserted (9.1C), so every existing row must carry a valid hash. This, not source_id, is the deduplication key — see unique index idx_amaia_health_conditions_dedup.';

comment on column public.amaia_medications.source_id
  is 'beneficiario_medicamento.id from AMAIA. Traceability pointer only — NOT part of the deduplication key, for the same reason documented on amaia_health_conditions.source_id.';

comment on column public.amaia_medications.canonical_text
  is 'Result of deterministic canonicalization applied to medication_original. No automatic semantic correction is ever applied (e.g. "astorvastatina" / "ASTORVACTATINA" / "Atorvastatina" remain distinct canonical entries unless unified in a future, human-reviewed phase).';

comment on column public.amaia_medications.hash_version
  is 'Version tag of the canonicalization algorithm used to produce hash (e.g. "canonicalization_v1").';

comment on column public.amaia_medications.hash
  is 'Deterministic hash of (beneficiary_amaia_id + canonical_text) under hash_version. NOT NULL by design: a row with empty canonicalization is never inserted (9.1C), so every existing row must carry a valid hash. Deduplication key — see unique index idx_amaia_medications_dedup.';
