// Test helper (integration tests and `pnpm acceptance m06`): works out the right and a wrong
// response of a served practice item straight from the library, the way the api judges it
// (TEMPLATE items: the variant of the served seed). Local test databases only.
import type postgres from 'postgres';
import {
  renderVariant,
  type ItemAnswer,
  type ItemTemplate,
  type ItemType,
} from '../../packages/domain/src/index.ts';

export interface Solved {
  type: ItemType;
  kind: 'STATIC' | 'TEMPLATE';
  stemMd: string;
  answer: ItemAnswer;
  correct: Record<string, unknown>;
  wrong: Record<string, unknown>;
}

interface Row {
  type: ItemType;
  kind: 'STATIC' | 'TEMPLATE';
  stem_md: string;
  options: { id: string }[];
  answer: ItemAnswer | null;
  template: {
    params: ItemTemplate['params'];
    constraints: string[];
    answer_expr: string;
    render: ItemTemplate['render'];
    distractor_exprs: string[];
  } | null;
}

export async function solve(
  sql: postgres.Sql,
  itemId: string,
  seed: number | null,
): Promise<Solved> {
  const [row] = await sql<Row[]>`
    select i.type, i.kind, i.stem_md, i.options, i.answer,
           (select row_to_json(t) from library.item_templates t where t.item_id = i.id) as template
    from library.items i where i.id = ${itemId}`;
  if (!row) throw new Error(`item ${itemId} not found`);
  let answer = row.answer;
  let options = row.options;
  let stemMd = row.stem_md;
  if (row.kind === 'TEMPLATE') {
    const variant = renderVariant(
      {
        item: itemId,
        type: row.type,
        params: row.template!.params,
        constraints: row.template!.constraints,
        answerExpr: row.template!.answer_expr,
        render: row.template!.render,
        distractorExprs: row.template!.distractor_exprs,
      },
      seed!,
    );
    if (!variant.ok) throw new Error(`variant ${itemId}#${seed}: ${variant.error}`);
    ({ answer, options, stemMd } = variant.value);
  }
  const a = answer as Record<string, unknown>;
  const other = (id: unknown) => options.find((o) => o.id !== id)?.id ?? 'zz';
  let correct: Record<string, unknown>;
  let wrong: Record<string, unknown>;
  switch (row.type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      correct = { optionId: a.optionId };
      wrong = { optionId: other(a.optionId) };
      break;
    case 'multi_choice':
      correct = { optionIds: a.optionIds };
      wrong = {
        optionIds: [options.find((o) => !(a.optionIds as string[]).includes(o.id))?.id ?? 'zz'],
      };
      break;
    case 'true_false':
      correct = { value: a.value };
      wrong = { value: !a.value };
      break;
    case 'numeric':
      correct = { value: a.value };
      wrong = { value: (a.value as number) + 1 + ((a.tolerance as number | undefined) ?? 0) * 2 };
      break;
    case 'fill_blank':
      correct = { blanks: (a.blanks as string[][]).map((b) => b[0]) };
      wrong = { blanks: (a.blanks as string[][]).map(() => 'zzz-sai') };
      break;
    case 'word_bank':
      correct = { blankOptionIds: a.blankOptionIds };
      wrong = { blankOptionIds: (a.blankOptionIds as string[]).map((id) => other(id)) };
      break;
    case 'ordering':
      correct = { order: a.order };
      wrong = { order: [...(a.order as string[])].reverse() };
      break;
    case 'matching': {
      const pairs = a.pairs as [string, string][];
      correct = { pairs };
      wrong = { pairs: pairs.map(([l], i) => [l, pairs[(i + 1) % pairs.length]![1]]) };
      break;
    }
    default:
      throw new Error(`cannot solve ${row.type}`);
  }
  return { type: row.type, kind: row.kind, stemMd, answer: answer!, correct, wrong };
}

/** Moves a throwaway student's learning timestamps into the past ("time passes"). */
export async function ageLearning(sql: postgres.Sql, studentId: string, interval: string) {
  await sql.begin(async (tx) => {
    await tx`
      update app.student_skill_states
      set last_attempt_at = last_attempt_at - ${interval}::interval,
          last_mastered_at = last_mastered_at - ${interval}::interval,
          next_review_at = next_review_at - ${interval}::interval
      where student_id = ${studentId}`;
    await tx`
      update app.review_schedule
      set due_at = due_at - ${interval}::interval,
          last_reviewed_at = last_reviewed_at - ${interval}::interval
      where student_id = ${studentId}`;
    await tx`
      update app.student_item_history set last_seen_at = last_seen_at - ${interval}::interval
      where student_id = ${studentId}`;
  });
}

export interface PracticeScope {
  /** Node with the most practicable skills among those matching (a topic for a diagnostic). */
  topicId: string;
  topicTitle: string;
  skillIds: string[];
}

/** A curriculum node of the grade-subject (title filter optional) with at least `minSkills` practicable skills. */
export async function findTopic(
  sql: postgres.Sql,
  grade: number,
  subject: string,
  titleLike: string | null,
  minSkills = 2,
): Promise<PracticeScope | null> {
  const rows = await sql<{ id: string; title_vi: string; skills: string[] }[]>`
    with recursive up as (
      select n.id as skill_id, n.parent_id as node_id
      from library.curriculum_nodes n
      where n.level = 'SKILL' and n.status = 'ACTIVE' and n.grade = ${grade} and n.subject = ${subject}
        and exists (select 1 from library.items i where i.skill_ids @> array[n.id]
                    and i.status in ('APPROVED', 'PUBLISHED') and i.type <> 'written')
      union all
      select u.skill_id, p.parent_id from up u join library.curriculum_nodes p on p.id = u.node_id
      where p.parent_id is not null
    )
    select n.id, n.title_vi, array_agg(u.skill_id) as skills
    from up u join library.curriculum_nodes n on n.id = u.node_id
    where n.level not in ('GRADE', 'SUBJECT') and n.status = 'ACTIVE'
      ${titleLike === null ? sql`` : sql`and n.title_vi ilike ${titleLike}`}
    group by n.id, n.title_vi
    having count(*) >= ${minSkills}
    order by count(*) desc, n.title_vi
    limit 1`;
  const row = rows[0];
  return row ? { topicId: row.id, topicTitle: row.title_vi, skillIds: row.skills } : null;
}
