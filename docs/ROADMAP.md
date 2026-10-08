# VionX Roadmap v4 (Android + Supabase)

Strict order. Start a module only when its dependencies are DONE. One branch and one PR per module.
Status: TODO | IN_PROGRESS | DONE | BLOCKED.

## Phase A — Family loop alpha (Grade 2 + Grade 6 Math libraries)
| ID | Module | Depends on | Status |
|---|---|---|---|
| M00 | Foundation: monorepo, Supabase, `api` function, Expo app, admin SPA, AiGateway, queues/cron | – | IN_PROGRESS (code complete; owner checks pending, see M00_REPORT) |
| M01 | Identity & household (parent Google/OTP, child ID+PIN) | M00 | DONE (runnable acceptance green; Maestro flow and Google sign-in need an emulator and owner OAuth setup, see M01_REPORT) |
| M02 | Consent & privacy core | M01 | TODO |
| M03 | Calendar, timetable & tasks | M02 | TODO |
| M04 | Reward engine | M03 | TODO |
| M05 | Curriculum & shared content library core (+ import) | M02 | TODO |
| X01 | Toán 6 library: 500 items (build scripts, Claude batch + review) | M05 | TODO |
| X02 | Toán 2 library: 500 items (same scripts, read-aloud, SVG) | X01 | TODO |
| M06 | Practice sessions, mastery, T0 hints, template variants, Grade 1-3 mode | M04, M05, X01, X02 | TODO |
| M07 | Today planner | M06 | TODO |
| M08 | Parent dashboard & gradebook (in app) | M07 | TODO |
| M09 | Offline, push, ops, Play internal testing | M08 | TODO |
| **GATE A** | §43 flow on real Android phones with 2-5 families, including at least one Grade 2 and one Grade 6 child | M00–M09, X01, X02 | TODO |

## Library rollout after GATE A (runs alongside Phase B, one library at a time)
| ID | Library | Depends on | Status |
|---|---|---|---|
| X03 | Tiếng Việt 2 | GATE A | TODO |
| X04 | Ngữ văn 6 | X03 | TODO |
| X05 | Tiếng Anh 6 | X04 | TODO |
| X06 | Tiếng Anh 2 | X05 | TODO |
| X07 | Khoa học tự nhiên 6 | X06 | TODO |
| X08 | Tự nhiên và Xã hội 2 | X07 | TODO |

All use `TASK_PACKS/X01.md` scripts with the subject profile from `docs/CONTENT_PLAN_vi.md`. Language libraries need a language reviewer.

## Phase B — Book → library pipeline & tutor
| ID | Module | Depends on | Status |
|---|---|---|---|
| M10 | Book import (admin), ingest runs, job framework | GATE A | TODO |
| M11 | Page extraction: text layer first, Claude for hard pages | M10 | TODO |
| M12 | Structure & curriculum mapping + review | M11 | TODO |
| M13 | Source search (full-text by skill) + retrieval eval | M12 | TODO |
| M14 | Content factory: 500/subject, templates, verify, review, quality loop, top-up | M13 | TODO |
| M15 | AI tutor T1-T3 + Q&A library growth | M14 | TODO |
| **GATE B** | Pipeline (M10-M14) rebuilds one launch library (e.g. Tiếng Việt 2) at X-script quality, from the books alone | M10–M15 | TODO |

## Phase C — Expansion
| ID | Module | Depends on | Status |
|---|---|---|---|
| M16 | Reading library | GATE A | TODO |
| M17 | Language skills: AI writing feedback (Tiếng Việt 2, Ngữ văn 6, English), on-device speech, unlock `written` items | GATE A, X03 | TODO |
| M18 | Activity: Health Connect (activity only) + manual log | GATE A | TODO |
| M19 | Arena single-player | GATE A | TODO |
| M20 | Competitions | GATE A | TODO |
| M21 | Strength insights | M16–M19 + 8 weeks data | TODO |

## Phase D — Launch
| ID | Module | Depends on | Status |
|---|---|---|---|
| M22 | Production readiness (VN SMS OTP, legal, residency, spend limits) | GATE A | TODO |
| M23 | Hardening & Google Play release | M22 | TODO |

Other grades and subjects start only after the 8 launch libraries pass review and alpha feedback (CONTRACT D6). After GATE B they go through the pipeline, one grade-subject at a time, 500 items each.
