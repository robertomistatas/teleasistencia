# AMAIA-SYNC — POST-R2-PROD-01
## ARCHITECTURE v0.2 DIFFERENTIAL REVIEW — KIMI K3

**Role:** Forensic Engineer / Adversarial Implementation Reviewer  
**Reviewed artifacts:**
- `AMAIA_SYNC_POST_R2_AUTONOMOUS_PIPELINE_ARCHITECTURE_v0.2_CANDIDATE.md`
- `AMAIA_SYNC_POST_R2_PROD_01_ARCHITECTURE_CONVERGENCE_RESOLUTION_v0.1_CANDIDATE.md`

**Reviewed branch:** `post-r2-prod-01-autonomous-pipeline`  
**Reviewed commits:** `8fc83f4` + `539cf88`  
**Mode:** read-only; no artifacts modified.

---

## 1. Prior-finding closure matrix

Kimi's differential review rechecked eleven prior technical findings from the v0.1 review and classified every one as CLOSED at the architecture level:

| # | Prior issue | v0.2 closure | Disposition |
|---:|---|---|---|
| 1 | Out-of-order MySQL commit visibility | §9 forbids assuming source id/timestamp equals commit order; requires overlap + anti-entropy; AT-AUTO-13/14 | **CLOSED** |
| 2 | Overlap / anti-entropy only optional | §9 makes both governed overlap and periodic anti-entropy mandatory | **CLOSED** |
| 3 | One-shot vs existing long-lived runtime | §4 defines existing runtime as predecessor/substrate and requires reconciliation | **CLOSED** |
| 4 | Lease/fencing unacknowledged | §8 and PA-CNV decisions require shared single-writer authority/fencing | **CLOSED** |
| 5 | Watermark monotonicity/regression | §8 requires fenced and persistence-layer monotonic watermark; AT-AUTO-17 | **CLOSED** |
| 6 | Split settlement: raw commits, derived work silently dropped | §12 requires atomic derived completion or durable auto-resumed obligation; AT-AUTO-16 | **CLOSED** |
| 7 | Replay convergence weaker than no duplicates | §11 requires convergence to the same correct operational state; AT-AUTO-05/15 | **CLOSED** |
| 8 | Backlog drainage/page size as silent ceiling | §13 makes page size a resource control, not a progress ceiling; AT-AUTO-19 | **CLOSED** |
| 9 | Timestamp/timezone semantics | §10 normalizes durable instants to UTC and governs source local time under `America/Santiago`; AT-AUTO-20 | **CLOSED** |
| 10 | Dual runner / manual-vs-scheduled authority | §7.3/§8 and AT-AUTO-18/21 require the same authority/fence | **CLOSED** |
| 11 | Net2phone future-writer discipline | §20 binds future provider evidence to same canonical layer, PI-01D authority/conflict rules and derived-state convergence discipline | **CLOSED** |

**Net prior-finding posture: 11/11 CLOSED.**

No prior technical finding was weakened or narrowed.

---

## 2. New-failure-mode attack on v0.2 amendments

The review attacked only the amendments introduced by v0.2.

### N1 — Settlement-class bifurcation

v0.2 permits either atomic settlement or a durable downstream-obligation model. Kimi judged this acceptable architectural latitude because both classes are bound to the same no-silent-loss invariant and AT-AUTO-16 crash semantics.

**Disposition:** no defect.

### N2 — Obligation drain on empty-source runs

A blueprint could incorrectly optimize away repair work when the source returns zero new rows, even though incomplete durable obligations still exist.

**Disposition:** non-blocking observation.

Required blueprint/closure intent:

> Pending durable downstream obligations must be swept/resumed on every governed invocation independently of whether new source rows are present.

This became the later v0.2.1 EC-04 clarification.

### N3 — One-shot duration versus lease TTL

A legitimate backlog-drain run could outlive a lease TTL originally tuned for daemon-style cycles unless the blueprint proves authority remains valid for the full governed run.

**Disposition:** non-blocking observation.

Required blueprint/closure intent:

> Bind permitted run duration to authority lifetime, or retain governed heartbeat/renewal, before backlog-drain execution is considered safe.

This became the later v0.2.1 EC-05 clarification.

### N4 — Dead-man path externality

Kimi found the dead-man obligation consistent with the architecture's accepted single-node risk and correctly deferred alert transport/threshold mechanics.

**Disposition:** no finding.

### N5 — Canonical demotion of `amaia_call_logs`

The move to `raw_call_logs` as canonical evidence was treated as a deliberate correction of an already-existing divergence, not a newly introduced hazard.

**Disposition:** no finding.

### N6 — Anti-entropy versus monotonic watermark

Reprocessing older evidence must not regress the primary watermark. Kimi found v0.2's monotonic-watermark rule plus idempotent settlement sufficient and non-contradictory.

**Disposition:** no finding.

### N7 — Closed runtime terminal-state vocabulary

v0.2 correctly defers exact labels to reconciliation with existing U5–U8 runtime semantics instead of inventing new labels.

**Disposition:** no finding.

---

## 3. Findings this differential round

| ID | Severity | Finding |
|---|---|---|
| V2-1 | OBSERVATION | Durable repair obligations should be swept on every governed invocation even when source work is empty. |
| V2-2 | OBSERVATION | Blueprint must prove run duration remains within valid authority lifetime or use governed renewal/heartbeat. |

Counts:

- BLOCKER: **0**
- MAJOR: **0**
- MINOR: **0**
- OBSERVATION: **2**

---

## 4. Closure against prior verdict

Every prior v0.1 technical finding reviewed by Kimi is CLOSED at the architecture layer.

Constants such as overlap size, exact watermark mechanics, authority timing values and server-write-grant details remain correctly deferred to blueprint/physical qualification where the architecture already provides a binding invariant.

---

## 5. Final verdict

**`READY_WITH_NONBLOCKING_OBSERVATIONS`**

Kimi's conclusion was that v0.2 materially and verifiably closes all prior technical amendments; V2-1 and V2-2 are blueprint-binding/editorial observations rather than architecture defects. No new failure mode introduced by the amendments rises to MAJOR.

This review does not ratify the architecture and does not authorize implementation.