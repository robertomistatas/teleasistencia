-- AMAIA-SYNC
-- Migration 012
-- Extend amaia_sync_watermarks with watermark_expr.
-- Codex correction: watermark_type stays restricted to ('id', 'timestamp').
-- watermark_expr is purely descriptive metadata of how the comparison
-- value was derived when it is not a raw column (e.g. COALESCE(updatedAt,
-- createAt) for beneficiario/red). The cut-off value itself keeps living
-- in last_id / last_timestamp depending on watermark_type — no
-- last_expr_value column is introduced.

alter table public.amaia_sync_watermarks
  add column if not exists watermark_expr text;

comment on column public.amaia_sync_watermarks.watermark_expr
  is 'Descriptive metadata only. Null when the watermark compares a raw source column directly. Non-null when the comparison value is derived from an expression (e.g. "COALESCE(updatedAt, createAt)") — the evaluated cut-off value is still stored in last_timestamp (or last_id), never in this column.';

-- Document the existing entries and backfill watermark_expr for the
-- domains validated empirically as requiring an expression (9.1D V-004,
-- V-007). No structural change to seeded rows, no new rows beyond what
-- Fase 9.1 already seeded.

update public.amaia_sync_watermarks
set watermark_expr = 'COALESCE(updatedAt, createAt)'
where entity_name in ('beneficiario', 'red')
  and watermark_expr is null;
