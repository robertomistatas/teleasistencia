# AMAIA-SYNC Schema Blueprint v1.0.1

**Phase:** 9.3-schema  
**Status:** Blueprint — pending Codex audit before DDL  
**Supersedes:** AMAIA_SYNC_SCHEMA_BLUEPRINT_v1.0.md (3 corrections)  
**Author:** Claude (constructor)  
**Date:** 2026-06-18

---

## Scope

All content from v1.0 is incorporated by reference unless explicitly superseded below. This revision corrects 3 schema-level inconsistencies. No architectural changes. No modifications to any module beyond the specific columns and triggers listed.

---

## Correction 1: cycle_id FK semantics — NOT NULL + ON DELETE RESTRICT

### Problem

v1.0 declares cycle_id as NOT NULL on both amaia_sync_runs and amaia_sync_reconciliation_results, but the FK uses ON DELETE SET NULL. These are contradictory: SET NULL requires a nullable column.

### Decision: NOT NULL + ON DELETE RESTRICT

**Rationale:** Cycles are the root of the traceability chain. Every run and every reconciliation result must belong to a cycle. Deleting a cycle while runs reference it would sever the audit trail — this must be prevented, not accommodated with NULL fallback.

- cycle_id remains **NOT NULL** (every run/result belongs to a cycle).
- FK action changes from **ON DELETE SET NULL** to **ON DELETE RESTRICT**.
- Consequence: a cycle cannot be deleted while any sync_runs or reconciliation_results rows reference it. This is the correct behavior — cycle deletion is an exceptional administrative action that requires first archiving or deleting dependent rows.

### Affected tables

| Table | Column | Nullable | FK action (v1.0) | FK action (v1.0.1) |
|---|---|---|---|---|
| amaia_sync_runs | cycle_id | no | ON DELETE SET NULL | **ON DELETE RESTRICT** |
| amaia_sync_reconciliation_results | cycle_id | no | ON DELETE SET NULL | **ON DELETE RESTRICT** |

No other FKs are affected. All other ON DELETE SET NULL FKs in the blueprint reference nullable columns (e.g., detection_run_id, origin_run_id) and are consistent.

---

## Correction 2: Subject identity immutability — Trigger enforcement

### Problem

v1.0 states that domain_name and excluded_amaia_id on amaia_sync_manifest_exclusion_subjects are "immutable by convention." Convention is not enforcement. These columns are part of the UNIQUE constraint and the stable identity of the subject. Any change would break referential consistency with investigations that denormalize these values.

### Decision: Trigger-enforced immutability

The existing set_updated_at trigger (trigger #9 in v1.0) is replaced by a dedicated trigger that combines updated_at maintenance with identity column immutability enforcement.

**Trigger behavior (BEFORE UPDATE):**

1. If OLD.domain_name != NEW.domain_name: raise exception 'domain_name is immutable'.
2. If OLD.excluded_amaia_id != NEW.excluded_amaia_id: raise exception 'excluded_amaia_id is immutable'.
3. If OLD.created_at != NEW.created_at: raise exception 'created_at is immutable'.
4. Set NEW.updated_at = now().

DELETE is permitted on subjects (unlike the append-only ledger tables). A subject with no investigations, no decisions, and no consumptions may be cleaned up by an administrator. FK CASCADE from investigations handles referential cleanup. This is an exceptional administrative action, not a normal operation.

### Immutable columns on amaia_sync_manifest_exclusion_subjects

| Column | Immutable? | Enforcement |
|---|---|---|
| id | Yes (PK) | PK constraint |
| domain_name | **Yes** | Trigger (v1.0.1) |
| excluded_amaia_id | **Yes** | Trigger (v1.0.1) |
| current_investigation_id | No (updated on new investigation) | — |
| current_investigation_seq | No (updated on new investigation) | — |
| created_at | **Yes** | Trigger (v1.0.1) |
| updated_at | No (auto-set by trigger) | — |

---

## Correction 3: Updated Triggers Inventory

Trigger #9 in v1.0 is replaced. Total trigger count remains 9.

| # | Table | Trigger name | v1.0 | v1.0.1 |
|---|---|---|---|---|
| 1–8 | (all other tables) | (unchanged) | (unchanged) | (unchanged) |
| 9 | amaia_sync_manifest_exclusion_subjects | **subject_identity_guard** | set_updated_at (standard) | BEFORE UPDATE: reject changes to domain_name, excluded_amaia_id, created_at; set updated_at = now(). Replaces the generic set_updated_at with a combined trigger. |

No triggers added or removed. Count: 9.

---

## Corrections Summary

| # | Problem | Resolution | Affected tables | Impact |
|---|---|---|---|---|
| 1 | cycle_id NOT NULL + ON DELETE SET NULL contradictory | ON DELETE RESTRICT. Cycles cannot be deleted while referenced. | amaia_sync_runs, amaia_sync_reconciliation_results | FK action change only |
| 2 | Subject identity columns immutable "by convention" only | Trigger-enforced immutability for domain_name, excluded_amaia_id, created_at | amaia_sync_manifest_exclusion_subjects | Trigger logic change |
| 3 | Trigger inventory stale after correction 2 | Trigger #9 updated: set_updated_at → subject_identity_guard | — | Documentation |

---

## Modules NOT modified

All other sections of v1.0 are unchanged:

- Cycles (section 1) — only FK action corrected, no column/constraint changes
- Manifests (section 2)
- Workset Exception Ledger (section 3: 3 tables)
- Manifest Exclusion Ledger (section 4: 4 tables) — only subject trigger corrected
- Remediation Queue (section 5)
- Reconciliation Segments (section 6)
- Deployed table modifications (section 7) — only cycle_id FK action corrected
- Lease/Fencing (section 8)
- Indexes (section 10)
- Self-audit findings (section 12) — all scenarios still resist; correction 2 closes the "denormalized columns stale" risk noted in v1.0 Risk 3

---

**End of document.**
