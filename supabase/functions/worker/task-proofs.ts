// Tick maintenance for proof photos: files in the private `task-proofs` bucket that no completion
// references after a day (upload abandoned, or the child/household was purged) are removed.
import { ORPHAN_PROOF_MAX_AGE_HOURS } from '@vionx/domain';
import { orphanProofPaths } from '../api/calendar/repo.ts';
import type { Sql } from '../_shared/db.ts';
import {
  ASSESSMENT_FILE_BUCKET,
  TASK_PROOF_BUCKET,
  type ObjectStorage,
} from '../_shared/storage.ts';

export async function removeOrphanProofs(sql: Sql, storage: ObjectStorage): Promise<number> {
  const paths = await orphanProofPaths(sql, TASK_PROOF_BUCKET, ORPHAN_PROOF_MAX_AGE_HOURS, 100);
  if (paths.length === 0) return 0;
  await storage.remove(TASK_PROOF_BUCKET, paths);
  return paths.length;
}

/** M08: the same for photos and PDFs of school tests that no grade references after a day. */
export async function removeOrphanAssessmentFiles(
  sql: Sql,
  storage: ObjectStorage,
): Promise<number> {
  const rows = await sql<{ name: string }[]>`
    select o.name from storage.objects o
    where o.bucket_id = ${ASSESSMENT_FILE_BUCKET}
      and o.created_at < now() - make_interval(hours => ${ORPHAN_PROOF_MAX_AGE_HOURS})
      and not exists (select 1 from app.school_assessments a where a.attachment_path = o.name)
    order by o.created_at limit 100`;
  if (rows.length === 0) return 0;
  await storage.remove(
    ASSESSMENT_FILE_BUCKET,
    rows.map((r) => r.name),
  );
  return rows.length;
}
