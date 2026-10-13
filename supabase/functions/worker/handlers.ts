import type { TxSql } from '../_shared/db.ts';
import type { EventHandlers } from '../_shared/queue.ts';
import { materialiseAll } from '../_shared/tasks.ts';
import { runExportJob, type ExportDeps } from './privacy-export.ts';

export type HandlerDeps = ExportDeps;

async function cancelConsentJobs(tx: TxSql, studentId: string, consentType: string) {
  const [row] = await tx<{ removed: number }[]>`
    select ops.cancel_consent_jobs(${studentId}::uuid, ${consentType}) as removed`;
  return row?.removed ?? 0;
}

/**
 * Event type → handler. Modules register their consumers here (reward conversion, Today
 * regeneration, notifications, exports, AI batch polling...). Unknown types are acknowledged
 * as no-ops so the queue never backs up on events nobody consumes yet.
 */
export function createHandlers(deps: HandlerDeps): EventHandlers {
  return {
    // Smoke event used by the M00 acceptance script; consuming it has no side effects.
    'system.ping': async () => {},

    // CONTRACT §5: revocation cancels queued jobs of that scope (CORE_SERVICE or CROSS_BORDER_TRANSFER: every scope).
    'consent.revoked': async (event, tx) => {
      const { studentId, consentType } = event.payload as {
        studentId: string;
        consentType: string;
      };
      const removed = await cancelConsentJobs(tx, studentId, consentType);
      await tx`
        insert into ops.audit_logs (actor_type, action, target_type, target_id, household_id, details)
        values ('system', 'consent.jobs_cancelled', 'student', ${studentId}, ${event.householdId},
                ${tx.json({ consentType, removedJobs: removed, eventId: event.id })})`;
    },

    // A child or account scheduled for deletion gets no more queued work.
    'privacy.deletion_requested': async (event, tx) => {
      const payload = event.payload as { scope: 'CHILD' | 'ACCOUNT'; studentId?: string };
      const students =
        payload.scope === 'CHILD' && payload.studentId
          ? [payload.studentId]
          : (
              await tx<{ id: string }[]>`
                select id from app.students where household_id = ${event.householdId}`
            ).map((r) => r.id);
      for (const id of students) await cancelConsentJobs(tx, id, 'CORE_SERVICE');
    },

    // M03: daily request from pg_cron (vionx-task-materialise) → next 14 days of recurring tasks.
    'task.materialise_requested': async (event, tx) => {
      const result = await materialiseAll(tx, deps.now?.() ?? new Date());
      await tx`
        insert into ops.audit_logs (actor_type, action, target_type, target_id, details)
        values ('system', 'task.materialised', 'domain_event', ${event.id},
                ${tx.json({ tasks: result.tasks, created: result.created })})`;
    },

    'privacy.export_requested': async (event, tx) => {
      const { jobId } = event.payload as { jobId: string };
      await runExportJob(tx, jobId, deps);
    },
  };
}
