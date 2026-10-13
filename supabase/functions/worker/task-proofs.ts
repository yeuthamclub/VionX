// Tick maintenance for proof photos: files in the private `task-proofs` bucket that no completion
// references after a day (upload abandoned, or the child/household was purged) are removed.
import { ORPHAN_PROOF_MAX_AGE_HOURS } from '@vionx/domain';
import { orphanProofPaths } from '../api/calendar/repo.ts';
import type { Sql } from '../_shared/db.ts';
import { TASK_PROOF_BUCKET, type ObjectStorage } from '../_shared/storage.ts';

export async function removeOrphanProofs(sql: Sql, storage: ObjectStorage): Promise<number> {
  const paths = await orphanProofPaths(sql, TASK_PROOF_BUCKET, ORPHAN_PROOF_MAX_AGE_HOURS, 100);
  if (paths.length === 0) return 0;
  await storage.remove(TASK_PROOF_BUCKET, paths);
  return paths.length;
}
