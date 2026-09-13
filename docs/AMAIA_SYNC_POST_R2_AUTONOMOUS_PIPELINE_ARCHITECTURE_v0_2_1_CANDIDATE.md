# AMAIA-SYNC — POST-R2 AUTONOMOUS PIPELINE ARCHITECTURE v0.2.1 CANDIDATE

**Status:** CANDIDATE — NOT RATIFIED  
**Program:** POST-R2-PROD-01 — Productionization & Sanitization  
**Final Ratification Authority (FRA):** Roberto  
**Architecture owner:** Principal Architect  
**Normative base:** `AMAIA_SYNC_POST_R2_AUTONOMOUS_PIPELINE_ARCHITECTURE_v0.2_CANDIDATE.md`  
**v0.2 commit:** `8fc83f4301db49a9f0496c670aa5a853ad6125a9`  
**v0.2 blob:** `5d3e423759b0251f2ea9d1acf674740f21e8b297`

---

## 1. Version semantics

v0.2.1 is the editorial-closure successor to v0.2.

The complete normative content of v0.2 is incorporated by reference into v0.2.1. The six clarifications below control only where they make v0.2 more explicit. No v0.2 architecture decision, safety invariant, acceptance obligation, program gate, or implementation STOP condition is weakened or removed.

v0.1 and v0.2 remain historical and byte-identical.

---

## 2. Differential-review basis

The v0.2 differential review completed with no residual BLOCKER or MAJOR architecture finding:

- Claude: all 15 prior amendments CLOSED; non-blocking editorial observations only.
- Max: all prior BLOCKER/MAJOR findings CLOSED; non-blocking observation only.
- Kimi K3: all 11 prior technical findings CLOSED; non-blocking observations only.

v0.2.1 incorporates the resulting editorial closure set and introduces no new architecture direction.

---

## 3. EC-01 — U4–U8 self-containment

For this architecture, **U4–U8** means:

- **U4 — ProcessPriorityGate**
- **U5 — DomainRunner**
- **U6 — AuthorityWatchdog**
- **U7 — ShutdownCoordinator**
- **U8 — RuntimeOrchestrator**

The existing lease/authority/fencing/heartbeat machinery, including Authority-Verifying Lease Manager (AVLM) work, is related runtime substrate and is not silently superseded by the U4–U8 shorthand.

This clarification controls the first and every subsequent normative U4–U8 reference in v0.2.

---

## 4. EC-02 — Incremental sync and anti-entropy topology

The v0.2 requirement for governed incremental overlap plus periodic anti-entropy remains mandatory.

The Physical Implementation Blueprint SHALL explicitly adjudicate whether anti-entropy executes inside the normal one-shot invocation or as a separately scheduled governed unit.

Whichever topology is selected:

- anti-entropy SHALL participate in the applicable single-writer authority and fencing model;
- anti-entropy SHALL preserve idempotent/convergent settlement behavior;
- anti-entropy SHALL NOT become a bypass around the primary runtime authority model.

Exact topology, cadence, and historical window remain blueprint/qualification decisions.

---

## 5. EC-03 — Operational freshness means derived-state convergence

For an operational Seguimientos workspace, **latest successful synchronization** SHALL mean the latest point at which the derived operational state required by that workspace has converged successfully.

A successful raw-ingestion commit or watermark advance alone SHALL NOT allow the workspace to be represented as operationally current while required correlation, follow-up, or status work remains pending.

Raw-source freshness and operational/derived-state freshness MAY be exposed separately, but the operationally-current reference SHALL track derived-state convergence.

This clarification controls v0.2 §19 and AT-AUTO-29.

---

## 6. EC-04 — Durable repair obligations run even with zero new source rows

Where v0.2 settlement class 2 is used, pending durable downstream/derived-state obligations SHALL be swept or resumed on every governed invocation independently of whether the current source gather produces new rows.

A zero-new-source-row invocation SHALL NOT skip pending repair merely because source work is empty.

This clarification controls v0.2 §12 and AT-AUTO-16.

---

## 7. EC-05 — Run duration versus authority lifetime

The Physical Implementation Blueprint SHALL mechanically prove that governed write authority remains valid for the complete permitted duration of every run.

That proof MAY use:

- a valid maximum-run-duration versus authority-lifetime bound;
- governed heartbeat/renewal;
- another independently reviewed equivalent consistent with the ratified runtime authority model.

Backlog-drain work SHALL NOT silently continue after authority/fence validity expires.

Exact timing constants remain blueprint/qualification decisions.

This clarification controls v0.2 §§8 and 13 and AT-AUTO-19.

---

## 8. EC-06 — Review-record correction

For the historical Claude v0.1 contract review, the selected verdict was exactly:

`REQUIRES_ARCHITECTURE_AMENDMENTS`

`READY_FOR_CONVERGENCE` was an available enum option, not Claude's selected v0.1 verdict. Future convergence records SHALL preserve that distinction.

This is a record correction only and changes no architecture invariant.

---

## 9. Acceptance-suite effect

The full AT-AUTO-01 through AT-AUTO-30 suite defined by v0.2 remains binding and is not reduced.

v0.2.1 adds only these controlling interpretations:

- **AT-AUTO-16:** a later governed invocation must complete/repair pending downstream work even when it receives zero new source rows.
- **AT-AUTO-19:** backlog draining must remain inside valid governed authority for the permitted execution duration.
- **AT-AUTO-29:** the operational freshness reference must reflect derived-state convergence rather than raw-ingestion freshness alone.

---

## 10. Binding-decision effect

All v0.2 binding architecture decisions remain in force as the normative base of this candidate.

The following are clarified, not newly invented:

1. U4–U8 have the exact names defined in EC-01.
2. Anti-entropy topology is a mandatory Blueprint adjudication and must obey the same applicable authority/fencing discipline.
3. Durable repair work is not conditional on the arrival of new source rows.
4. Authority validity must span the complete permitted run or be renewed under the governed runtime model.
5. Seguimientos operational freshness is derived-state freshness, not merely raw-ingestion freshness.

---

## 11. Ratification boundary

Ratifying v0.2.1 means ratifying:

- the complete v0.2 architecture by normative incorporation; and
- EC-01 through EC-06 as controlling editorial clarifications.

Ratification does NOT authorize implementation and does NOT ratify unverified physical assumptions.

Implementation remains STOP until required physical inventories close and a Physical Implementation Blueprint is authored, independently reviewed, and FRA-ratified.

---

## 12. Candidate disposition

**CANDIDATE — EDITORIAL CLOSURE OF v0.2 DIFFERENTIAL REVIEW — REQUIRES FINAL DELTA VERIFICATION AND FRA RATIFICATION.**

v0.2.1 supersedes v0.2 architecturally only if and when FRA ratifies v0.2.1.