# ADR-001: Add a Toán 5 library

- Status: Accepted
- Date: 2026-11-10
- Deciders: Leo (product owner), Claude (lead engineer)

## Context

CONTRACT D6 limits launch scope to Grade 2 and Grade 6 (8 libraries) and requires an ADR for any other grade or subject.
The owner has Toán 5 sources: the 2018-curriculum textbook (SGK, 2 volumes), the teacher's guide (SGV) and a sample workbook (VBT).
He asked for a Toán 5 question library to be built.

## Decision

- Add a ninth subject profile, `(5, 'math', 'Toán 5')`, to `SUBJECT_PROFILES` (`packages/domain/src/library/profiles.ts`) and seed it in migration `0011_math5_profile.sql`.
- Profile values:
  - TEMPLATE share 45%;
  - no passage groups and no written items;
  - read-aloud off (`vi`);
  - images MEDIUM, because Grade 5 geometry needs figures.
- Item-type mix: single_choice 30%, numeric 35%, fill_blank 10%, and 5% each for multi_choice, true_false, ordering, matching and picture_choice.
- The skill backbone is the GDPT 2018 "yêu cầu cần đạt" for Grade 5 mathematics (D5), with the same package format (M05) and the same acceptance rules as the other libraries: at least 480 approved items, at least 2 per active skill, and template share within ±5 points.
- Items are drafted by Codex from the owner's sources and checked by Claude. The paid X01 pipeline is not used for this library. Every item still needs human approval before import.

## Consequences

- Launch scope is unchanged: Toán 5 is extra content and is not part of the alpha (D4).
  The app can serve it to any child whose grade is 5.
- The subject-profile test now reads every migration that seeds `library.subject_profiles`, not only 0008.
