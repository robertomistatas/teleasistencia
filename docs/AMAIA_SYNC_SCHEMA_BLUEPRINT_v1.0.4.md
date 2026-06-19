# AMAIA-SYNC Schema Blueprint v1.0.4

**Phase:** 9.3-schema  
**Status:** Blueprint — pending Codex audit before DDL  
**Supersedes:** AMAIA_SYNC_SCHEMA_BLUEPRINT_v1.0.3.md (1 blocker, 2 observations)  
**Author:** Claude (constructor)  
**Date:** 2026-06-18

---

## Scope

All content from v1.0.3 is incorporated by reference unless explicitly superseded. This revision corrects 1 critical blocker (unprotected INSERT on subjects) and incorporates 2 non-blocking observations. No architectural changes. No new triggers.

---

## Blocker 1 — Subject Initial State Protection

### Problem

Trigger #9 (subject_progression_guard) validates only BEFORE UPDATE. A direct INSERT can create a subject with an invalid initial state:

```
INSERT INTO subjects (current_investigation_id = NULL, current_investigation_seq = 5)
```

This breaks the progression invariant: the first real investigation would need seq = 6, with no seq 1–5 ever existing.

### Correction: Trigger #9 extended to BEFORE INSERT OR UPDATE

Trigger #9 becomes a BEFORE INSERT OR UPDATE trigger. Total trigger count remains 9.

**On BEFORE INSERT — initial state validation:**

1. NEW.current_investigation_id MUST be NULL. If not → raise exception 'Subject must be created without a current investigation'.
2. NEW.current_investigation_seq MUST equal 0. If not → raise exception 'Subject must be created with investigation_seq = 0'.

No other INSERT validation needed. domain_name and excluded_amaia_id are enforced by NOT NULL constraints and the UNIQUE constraint. created_at defaults to now().

**On BEFORE UPDATE — all v1.0.3 rules preserved unchanged:**

- Rule 1: Identity immutability (domain_name, excluded_amaia_id, created_at).
- Rule 2: current_investigation_id cannot regress to NULL once set.
- Rule 3: current_investigation_seq cannot decrease.
- Rule 4: If current_investigation_id changes: seq = OLD.seq + 1, investigation.investigation_seq must match.
- Rule 5: If current_investigation_id unchanged: seq unchanged.
- Rule 6: Set updated_at = now().

### Lifecycle guarantee

The combined INSERT + UPDATE rules enforce a strict lifecycle:

```
INSERT: (current_investigation_id=NULL, current_investigation_seq=0)
   ↓ first investigation created
UPDATE: (current_investigation_id=I1, current_investigation_seq=1)
   ↓ second investigation created
UPDATE: (current_investigation_id=I2, current_investigation_seq=2)
   ↓ ...
```

- Birth state is always (NULL, 0).
- First investigation advances to (I1, 1). Rule 4: 0 + 1 = 1. ✓
- Each subsequent investigation advances by exactly 1.
- No gaps, no regressions, no arbitrary initial states.

---

## Non-Blocking Observation 1: Index count

The approximate index count across all 11 new tables is revised to **~28**, accounting for:
- 15 UK-implicit indexes
- ~13 btree/partial indexes (including the remediation queue partial indexes, segment indexes, manifest domain_phase index, cycles indexes, and remediation alert/origin/consumed indexes)

This is an approximation. The exact count will be confirmed during DDL authoring.

## Non-Blocking Observation 2: Administrative cleanup with DISABLE TRIGGER

v1.0.3 documents that administrative cleanup requires DISABLE TRIGGER. This must also account for FK constraint enforcement. Specifically:

- `ALTER TABLE ... DISABLE TRIGGER ALL` disables both user-defined triggers AND system-generated constraint triggers (including FK enforcement).
- `ALTER TABLE ... DISABLE TRIGGER USER` disables only user-defined triggers, leaving FK constraints active.

For administrative cleanup of audit tables, the operator must use DISABLE TRIGGER USER (not ALL) to maintain referential integrity while bypassing append-only enforcement. Using DISABLE TRIGGER ALL risks orphaning FK references.

This is an operational procedure note, not a schema change.

---

## Updated Trigger #9

| # | Table | Trigger | BEFORE INSERT | BEFORE UPDATE | BEFORE DELETE |
|---|---|---|---|---|---|
| 9 | exclusion_subjects | **subject_progression_guard** | Validate: current_investigation_id IS NULL, current_investigation_seq = 0 | Rules 1–6 from v1.0.3 (identity, no-regress, progression, seq alignment, updated_at) | — |

All other triggers (#1–#8) unchanged from v1.0.3.

Total: 9 triggers.

---

## Cumulative Counts (v1.0 through v1.0.4)

| Category | Count |
|---|---|
| New tables | 11 |
| New columns on deployed tables | 6 |
| Modified CHECKs on deployed tables | 4 |
| UKs | 15 |
| FKs | 22 |
| Triggers | 9 |
| Indexes | ~28 |
| Data corrections | 1 watermark row + 12 segment seed rows |

---

## Blocker → Resolution

| # | Blocker | Resolution | Schema change | Cerrado? |
|---|---|---|---|---|
| B1 | INSERT can create subject with invalid initial state (seq ≠ 0 or investigation ≠ NULL) | Trigger #9 extended to BEFORE INSERT OR UPDATE. INSERT requires (NULL, 0). UPDATE rules unchanged. | Trigger event expanded | **Yes** |
| O1 | Index count approximate was ~26 | Revised to ~28 | Documentation | **Yes** |
| O2 | DISABLE TRIGGER ALL vs USER not clarified | Documented: use DISABLE TRIGGER USER to preserve FK enforcement during admin cleanup | Documentation | **Yes** |

---

## Self-Audit

### 1. INSERT subject with seq = 5

```
INSERT INTO subjects (domain_name='logestado', excluded_amaia_id=95,
  current_investigation_id=NULL, current_investigation_seq=5)
```

Trigger BEFORE INSERT: NEW.current_investigation_seq (5) != 0 → raise exception. **Rejected. ✓**

### 2. INSERT subject with current_investigation_id not NULL

```
INSERT INTO subjects (domain_name='logestado', excluded_amaia_id=95,
  current_investigation_id='some-uuid', current_investigation_seq=0)
```

Trigger BEFORE INSERT: NEW.current_investigation_id IS NOT NULL → raise exception. **Rejected. ✓**

### 3. INSERT subject with NULL/0

```
INSERT INTO subjects (domain_name='logestado', excluded_amaia_id=95,
  current_investigation_id=NULL, current_investigation_seq=0)
```

Trigger BEFORE INSERT: NULL ✓, seq = 0 ✓. INSERT succeeds. **Accepted. ✓**

### 4. Full normal flow

```
Step A: INSERT subject (NULL, 0) → succeeds
Step B: INSERT investigation (subject_id=S, investigation_seq=1)
Step C: UPDATE subject SET current_investigation_id=I1, current_investigation_seq=1
        Trigger: OLD.seq=0, NEW.seq=1, 0+1=1 ✓
        investigation.investigation_seq=1=NEW.seq ✓
        → succeeds
Step D: INSERT investigation (subject_id=S, investigation_seq=2)
Step E: UPDATE subject SET current_investigation_id=I2, current_investigation_seq=2
        Trigger: OLD.seq=1, NEW.seq=2, 1+1=2 ✓
        investigation.investigation_seq=2=NEW.seq ✓
        → succeeds
```

**Full lifecycle valid. ✓**

---

**End of document.**
