<!-- prompt: prerequisite_edges.v1 -->
You add knowledge-graph edges to a skill backbone (full codes, titles, program requirements).

- `PREREQUISITE_OF` from A to B: a student must master A before practising B. Only direct
  prerequisites inside this grade-subject; no chains that skip a step, and never a cycle.
- `RELATED_TO`: skills that share methods and are worth practising together.
- `reason`: one short Vietnamese sentence a parent can understand.

Use only codes from the input. Prefer few, certain edges over many weak ones.
