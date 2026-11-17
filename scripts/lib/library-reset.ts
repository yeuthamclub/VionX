// Local test helper: removes one grade-subject from the library so an import starts from scratch.
// Tests and acceptance only (the product never deletes library rows; it archives them).
import type postgres from 'postgres';

const FIXTURE_MAX_ITEMS = 50;

export async function resetLibraryScope(
  sql: postgres.Sql,
  grade: number,
  subject: string,
): Promise<void> {
  // Guard (ADR-002): the test fixtures have at most 10 items per grade-subject. A larger scope is
  // a reviewed library, which tests must never delete. Run them on a database without it.
  const [scope] = await sql<{ n: number }[]>`
    select count(*)::int as n from library.items where grade = ${grade} and subject = ${subject}`;
  if ((scope?.n ?? 0) > FIXTURE_MAX_ITEMS) {
    throw new Error(
      `resetLibraryScope refused: grade ${grade} ${subject} holds ${scope?.n} items, more than a ` +
        `test fixture (${FIXTURE_MAX_ITEMS}). This database holds a reviewed library; point the ` +
        'tests at a test database (see README, "Development").',
    );
  }
  await sql.begin(async (tx) => {
    // M06: learning rows of test families point at the items and skills removed below.
    await tx`delete from app.learning_sessions where grade = ${grade} and subject = ${subject}`;
    for (const table of [
      'student_item_history',
      'mistake_patterns',
      'review_schedule',
      'student_skill_states',
    ]) {
      const column = table === 'student_item_history' ? 'item_id' : 'skill_id';
      const source = column === 'item_id' ? 'items' : 'curriculum_nodes';
      await tx`
        delete from ${tx(`app.${table}`)} where ${tx(column)} in (
          select id from ${tx(`library.${source}`)} where grade = ${grade} and subject = ${subject})`;
    }
    await tx`
      delete from library.item_templates where item_id in (
        select id from library.items where grade = ${grade} and subject = ${subject})`;
    await tx`
      delete from library.item_stats where item_id in (
        select id from library.items where grade = ${grade} and subject = ${subject})`;
    await tx`
      delete from library.item_reports where item_id in (
        select id from library.items where grade = ${grade} and subject = ${subject})`;
    await tx`delete from library.items where grade = ${grade} and subject = ${subject}`;
    await tx`delete from library.item_groups where grade = ${grade} and subject = ${subject}`;
    await tx`delete from library.media_assets where grade = ${grade} and subject = ${subject}`;
    await tx`
      delete from library.book_lesson_mappings where series_id in (
        select id from library.book_series where grade = ${grade} and subject = ${subject})`;
    await tx`delete from library.book_series where grade = ${grade} and subject = ${subject}`;
    await tx`
      delete from library.knowledge_edges where from_node_id in (
        select id from library.curriculum_nodes where grade = ${grade} and subject = ${subject})
        or to_node_id in (select id from library.curriculum_nodes where grade = ${grade} and subject = ${subject})`;
    await tx`
      delete from library.tutor_answers where skill_id in (
        select id from library.curriculum_nodes where grade = ${grade} and subject = ${subject})`;
    await tx`delete from library.curriculum_nodes where grade = ${grade} and subject = ${subject}`;
    // The shared GRADE node goes once no subject of that grade remains.
    await tx`
      delete from library.curriculum_nodes g
      where g.level = 'GRADE' and g.grade = ${grade}
        and not exists (select 1 from library.curriculum_nodes n where n.parent_id = g.id)`;
    await tx`delete from library.import_runs where grade = ${grade} and subject = ${subject}`;
  });
}
