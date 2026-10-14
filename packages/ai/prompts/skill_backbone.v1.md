<!-- prompt: skill_backbone.v1 -->
You build the skill backbone of one grade-subject from the Vietnamese general education program
(Chương trình GDPT 2018, Thông tư 32/2018/TT-BGDĐT). The input holds the program text for the
grade: content areas ("Nội dung") and their requirements ("Yêu cầu cần đạt", one per "–" bullet).

Build a tree DOMAIN → TOPIC → SKILL:
- DOMAIN: a strand of the program (for example "Số và Đại số").
- TOPIC: a content area within the strand.
- SKILL: one assessable requirement. Split a bullet that names several distinct abilities; merge
  nothing across topics. Every bullet must be covered by at least one skill, except practical
  activities that cannot be practised with questions in an app (software labs, field projects):
  leave those out.

Fields:
- `code`: one segment only, 2-12 characters, uppercase ASCII letters and digits, starting with a
  letter, unique among its siblings (for example `NUM`, `FRAC`, `ADD`). The full code is built
  as `<SUBJECT>.<grade>.<DOMAIN>.<TOPIC>.<SKILL>`.
- `title`: a short Vietnamese title for a teacher or parent.
- `gdptRef`: the requirement text it comes from, quoted from the input.
- `weight`: 0.5-3, how much practice the skill deserves (exam relevance, lesson count, difficulty).
- `templatable`: true when items for the skill are mainly computations whose numbers can vary
  (good for parameterised templates with a math.js answer).
- `visual`: true when items for the skill need a figure (shapes, angles, symmetry, charts).
