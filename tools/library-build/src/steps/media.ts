// Step 7 `media [--topic CODE]`: one simple SVG per planned figure (svg_illustration, Batch). Each
// SVG is sanitised with the package sanitiser and rendered to PNG for the reviewer. A figure that
// fails is drawn once more on the next run. Output: media.jsonl, media/<code>.svg, media/png/.
import { Resvg } from '@resvg/resvg-js';
import { svgIllustrationOutputSchema } from '@vionx/ai/schemas';
import { sanitizeSvg } from '@vionx/domain';
import { runBatch } from '../ai/batch.ts';
import { PROMPT_VERSIONS, systemPrompt } from '../ai/prompts.ts';
import type { BuildContext } from '../context.ts';
import { readJsonl, writeFileAtomic, writeJsonl } from '../lib/jsonl.ts';
import { profileNotes } from '../profile.ts';
import { loadPlan } from './plan.ts';
import { backboneSkills, loadBackbone } from './structure.ts';

export interface MediaRecord {
  code: string;
  slot: string;
  attempt: number;
  file: string;
  alt: string;
  brief: string;
  ok: boolean;
  message?: string;
}

export const MEDIA_LICENSE = 'VionX original (AI-generated, reviewed)';
export const mediaCode = (slotId: string) => `${slotId}.FIG`;
const MAX_ATTEMPTS = 2;

/** Sanitises and renders an SVG; ok only when nothing had to be removed and the PNG is non-empty. */
export function checkSvgSource(svg: string): {
  ok: boolean;
  message?: string;
  clean?: string;
  png?: Uint8Array;
} {
  const result = sanitizeSvg(svg);
  if (!result.ok) return { ok: false, message: result.message ?? 'invalid SVG' };
  if (result.value.removed.length > 0)
    return {
      ok: false,
      message: `sanitiser removed ${result.value.removed.join(', ')}`,
      clean: result.value.svg,
    };
  try {
    const rendered = new Resvg(result.value.svg, {
      fitTo: { mode: 'width', value: 480 },
      background: '#ffffff',
    }).render();
    const png = rendered.asPng();
    if (rendered.width === 0 || rendered.height === 0 || png.length === 0)
      return { ok: false, message: 'renders empty', clean: result.value.svg };
    return { ok: true, clean: result.value.svg, png };
  } catch (e) {
    return {
      ok: false,
      message: `render failed: ${(e as Error).message}`,
      clean: result.value.svg,
    };
  }
}

export const loadMedia = (ctx: BuildContext) => readJsonl<MediaRecord>(ctx.path('media.jsonl'));

export async function media(ctx: BuildContext): Promise<void> {
  const plan = loadPlan(ctx);
  const skills = new Map(backboneSkills(loadBackbone(ctx)).map((s) => [s.code, s]));
  const records = new Map(loadMedia(ctx).map((m) => [m.slot, m]));
  const slots = plan.slots.filter((s) => s.svg && ctx.inTopic(s.skill));
  const jobs = slots.flatMap((slot) => {
    const prev = records.get(slot.id);
    if (prev?.ok) return [];
    const attempt = prev ? prev.attempt + 1 : 1;
    if (attempt > MAX_ATTEMPTS) return [];
    const skill = skills.get(slot.skill)!;
    return [
      {
        key: `${slot.id}@${attempt}`,
        item: {
          system: systemPrompt(PROMPT_VERSIONS.media, profileNotes(ctx.profile)),
          input: {
            slotId: slot.id,
            skill: { code: skill.code, title: skill.title, gdptRef: skill.gdptRef },
            level: slot.level,
            type: slot.type,
            ...(prev ? { previousProblem: prev.message } : {}),
          },
          outputSchema: svgIllustrationOutputSchema,
        },
      },
    ];
  });
  if (jobs.length === 0) {
    ctx.log(`media: ${slots.length} planned figure(s) in scope, nothing to draw`);
    ctx.markStep('media', 'done', { figures: records.size });
    return;
  }
  const outcome = await runBatch<{ brief: string; alt: string; svg: string }>(
    ctx,
    'media',
    'svg_illustration',
    PROMPT_VERSIONS.media,
    jobs,
  );
  for (const job of jobs) {
    const result = outcome.results.get(job.key);
    if (!result?.ok) continue;
    const slot = (job.item.input as { slotId: string }).slotId;
    const code = mediaCode(slot);
    const file = `${code}.svg`;
    const out = result.output!;
    const checked = checkSvgSource(out.svg);
    writeFileAtomic(ctx.path('media', file), checked.clean ?? out.svg);
    if (checked.png) writeFileAtomic(ctx.path('media', 'png', `${code}.png`), checked.png);
    records.set(slot, {
      code,
      slot,
      attempt: Number(job.key.split('@')[1]),
      file,
      alt: out.alt,
      brief: out.brief,
      ok: checked.ok,
      ...(checked.message ? { message: checked.message } : {}),
    });
  }
  writeJsonl(
    ctx.path('media.jsonl'),
    [...records.values()].sort((a, b) => a.code.localeCompare(b.code)),
  );
  const bad = [...records.values()].filter((m) => !m.ok);
  for (const m of bad)
    ctx.log(
      `  ! ${m.code}: ${m.message}${m.attempt >= MAX_ATTEMPTS ? ' (no attempts left: fix the SVG by hand)' : ' (re-run media to draw it again)'}`,
    );
  ctx.markStep('media', outcome.complete ? 'done' : 'pending', {
    figures: records.size,
    failed: bad.length,
  });
  ctx.log(`media: ${records.size} figure(s), ${bad.length} failed → media.jsonl, media/png/`);
}
