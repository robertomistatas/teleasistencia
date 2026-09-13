# AMAIA-SYNC — POST-R2-PRESERVE-01
## FINAL PRESERVATION REPORT v0.1 — RECORDED EVIDENCE

**Status:** `PRESERVATION_COMPLETE_VERIFIED`  
**Scope:** evidentiary metadata record of the externally preserved HPSoporte corpus.  
**Important:** the preservation archives themselves remain outside GitHub on HPSoporte. This document records the host-produced preservation result and its hashes; it does not place sensitive archive contents in the repository and does not convert local-only artifacts into canonical production authority.

---

## 1. Verified external destination

`C:\Users\Admin\Teleasistencia2026\POST_R2_PRESERVE_01_VERIFIED_20260912_145530`

The existing external preservation package was revalidated in place. No second copy was created and the source repository was not modified by that revalidation.

---

## 2. Integrity verification

- forensic manifest entries: **748**
- code/non-sensitive entries: **733**
- sensitive entries kept separately: **15**
- source hashes matching manifest: **748/748**
- expected ZIP entries: **733 + 15**
- missing ZIP entries: **0**
- sensitive material leaked into code ZIP: **0**
- ZIP list/read verification: **PASS**
- sampled file-hash verification: **PASS**
- `amaia-sync-runtime/dist`: marked `GENERATED_POST_INSPECTION_CONTAMINATED`

---

## 3. Principal preserved artifacts

### Code snapshot

`POST_R2_PRESERVE_01_CODE_SNAPSHOT_v0.1.zip`

SHA-256:

`3c5dc3cdc4e49e514d14bf8ca59cbbefb446938400db8b4ec28b5ab0ad218cbf`

### Sensitive-data snapshot

`POST_R2_PRESERVE_01_SENSITIVE_DATA_v0.1.zip`

SHA-256:

`af5f7b0bbff45247300f2adfca9b0288f27a5d9921af69d4356ddcef6aac2e43`

### Forensic manifest

`metadata\POST_R2_PRESERVE_01_FORENSIC_MANIFEST_v0.1.json`

SHA-256:

`7c3ff02b0214faa5c6cf82375c2da4686b10e75a1ea8bed287c89ef736fee29d`

Additional metadata artifacts present in the external preservation package:

- `metadata\POST_R2_PRESERVE_01_AUTHORITY_MAP_v0.1.md`
- `metadata\POST_R2_PRESERVE_01_FINAL_PRESERVATION_REPORT_v0.1.txt`

---

## 4. Category totals

| Category | Files | Bytes |
|---|---:|---:|
| A | 98 | 1,043,600 |
| B | 208 | 38,275,770 |
| C | 97 | 967,427 |
| D | 15 | 1,521,468 |
| E | 121 | 429,626 |
| F | 209 | 16,472,881 |

Total recorded manifest entries: **748**.

---

## 5. Revalidated Git source state

- branch: `main`
- local HEAD: `d5cc03ca49485cc4eff0099ccd5b4643593934c6`
- `origin/main`: `a92dd43818973eafbde550841e0ff84a60695b32`
- modified tracked: **15**
- staged: **0**
- untracked: **360**

The revalidation reported that none of the following were executed against the source checkout:

- `git clean`
- `git reset`
- `git stash`
- `git checkout`
- `git pull`
- `git commit`
- `git add`
- mass deletion

---

## 6. Recorded anomalies

1. A prior failed staging attempt remains separately at:
   `C:\Users\Admin\Teleasistencia2026\POST_R2_PRESERVE_01_20260912_145253`
2. `amaia-sync-runtime/dist` remains contaminated by prior inspection-time generation and is not authoritative source evidence.
3. No clean workspace was created as part of preservation.

---

## 7. Authority boundary

This record proves only the reported preservation result and its integrity metadata.

It SHALL NOT be interpreted as:

- ratification of local-only code;
- authorization to merge all preserved files;
- permission to expose the sensitive archive;
- implementation authorization;
- replacement for later artifact-by-artifact authority reconciliation.

The sensitive archive remains external and access-controlled.

---

## 8. Final recorded state

**`PRESERVATION_COMPLETE_VERIFIED`**

This repository record exists so later reviewers can corroborate that POST-R2-PRESERVE-01 was actually reported complete, while keeping the preserved binary/sensitive corpus outside GitHub.