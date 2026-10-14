// Test helper standing in for the human reviewer of a fake run: approves every row of
// review/review.csv and edits one (POLY.Q02) to exercise the EDITED path. Writes
// review/review.reviewed.csv and returns its path.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, toCsv } from '../src/lib/csv.ts';

export function simulateReview(workDir: string, edit = 'MATH.6.GEO.SHAPE.POLY.Q02'): string {
  const { header, rows } = parseCsv(readFileSync(join(workDir, 'review', 'review.csv'), 'utf8'));
  for (const row of rows) {
    if (row.code === edit) {
      row.verdict = 'EDITED';
      row.explanation_md = `${row.explanation_md} (Đã sửa lời giải cho rõ hơn.)`;
      row.reviewer_note = 'clarified the explanation';
    } else row.verdict = 'APPROVED';
  }
  const out = join(workDir, 'review', 'review.reviewed.csv');
  writeFileSync(out, toCsv(header, rows));
  return out;
}
