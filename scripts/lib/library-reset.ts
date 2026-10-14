// Local test helper: removes one grade-subject from the library so an import starts from scratch.
// Tests and acceptance only (the product never deletes library rows; it archives them).
import type postgres from 'postgres';

export async function resetLibraryScope(
  sql: postgres.Sql,
  grade: number,
  subject: string,
): Promise<void> {
  await sql.begin(async (tx) => {
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
