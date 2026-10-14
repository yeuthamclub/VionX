// Step 6 `passages`: original reading passages / dialogues / experiment scenarios for item groups
// (passage_generation, Batch). The MATH.6 profile has no groups (groupShare 0), so the step is a
// no-op there. `check` already runs the passage checks (copy, reading level) on any groups.
import type { BuildContext } from '../context.ts';

export async function passages(ctx: BuildContext): Promise<void> {
  const share = ctx.profile.library.groupShare;
  if (share === 0) {
    ctx.log(
      `passages: the ${ctx.profile.id} profile has no passage groups (groupShare 0); nothing to do`,
    );
    ctx.markStep('passages', 'done', { groups: 0 });
    return;
  }
  throw new Error(
    `${ctx.profile.id} needs passage groups (${Math.round(share * 100)}%); passage generation lands with the first run whose profile has groups (X03)`,
  );
}
