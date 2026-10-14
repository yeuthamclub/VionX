// Model drafts (item_generation.v1 output) → package items and templates; and the blind view the
// verifier sees.
import {
  isTemplateItemType,
  renderVariant,
  type ItemTemplate,
  type PackageItem,
  type TemplateParam,
} from '@vionx/domain';
import { parseAnswerJson } from './answers.ts';
import type { PlanSlot } from './plan.ts';

export interface ItemDraft {
  slotId: string;
  stemMd: string;
  options: { id: string; text: string; side: 'left' | 'right' | null }[];
  answerJson: string | null;
  answerCheckExpr: string | null;
  explanationMd: string;
  workedSolutionMd: string;
  hints: string[];
  distractorFeedback: { optionId: string; md: string; misconception: string | null }[];
  misconceptionTags: string[];
  template: {
    params: {
      name: string;
      type: 'int' | 'decimal' | 'choice';
      min: number | null;
      max: number | null;
      step: number | null;
      values: string[] | null;
    }[];
    constraints: string[];
    answerExpr: string;
    distractorExprs: string[];
    stem: string;
    explanation: string | null;
  } | null;
  sourceRefs: { kind: string; ref: string; page: number | null }[];
}

export interface Provenance {
  model: string;
  promptVersion: string;
  attempt: number;
  batchId?: string;
}

function param(p: NonNullable<ItemDraft['template']>['params'][number]): TemplateParam {
  if (p.type === 'choice') {
    const values = (p.values ?? []).map((v) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v));
    return { name: p.name, type: 'choice', values };
  }
  if (p.type === 'decimal')
    return { name: p.name, type: 'decimal', min: p.min ?? 0, max: p.max ?? 0, step: p.step ?? 0.1 };
  return {
    name: p.name,
    type: 'int',
    min: p.min ?? 0,
    max: p.max ?? 0,
    ...(p.step && p.step !== 1 ? { step: p.step } : {}),
  };
}

/**
 * Builds the package item for a slot. Kind, type, skill, level and difficulty come from the
 * approved plan, not from the model. Throws on unparsable answer JSON (the check marks it).
 */
export function draftToItem(
  draft: ItemDraft,
  slot: PlanSlot,
  media: string[],
  provenance: Provenance,
): { item: PackageItem; template?: ItemTemplate } {
  const template = slot.kind === 'TEMPLATE' && draft.template ? draft.template : null;
  const item: PackageItem = {
    code: slot.id,
    kind: slot.kind,
    skills: [slot.skill],
    difficulty: slot.difficulty,
    cognitiveLevel: slot.level,
    type: slot.type,
    stemMd: draft.stemMd,
    media,
    options:
      slot.kind === 'TEMPLATE'
        ? []
        : draft.options.map((o) => ({
            id: o.id,
            text: o.text,
            ...(o.side ? { side: o.side } : {}),
          })),
    answer: slot.kind === 'TEMPLATE' ? null : parseAnswerJson(draft.answerJson),
    explanationMd: draft.explanationMd,
    hints: draft.hints.map((md) => ({ md })),
    workedSolutionMd: draft.workedSolutionMd,
    distractorFeedback: Object.fromEntries(
      draft.distractorFeedback.map((f) => [
        f.optionId,
        { md: f.md, ...(f.misconception ? { misconception: f.misconception } : {}) },
      ]),
    ),
    misconceptionTags: draft.misconceptionTags,
    sourceRefs: draft.sourceRefs.map((r) => ({
      kind: r.kind,
      ref: r.ref,
      ...(r.page ? { page: r.page } : {}),
    })),
    provenance: {
      models: [provenance.model],
      promptVersion: provenance.promptVersion,
      attempt: provenance.attempt,
      ...(provenance.batchId ? { batchId: provenance.batchId } : {}),
      ...(draft.answerCheckExpr ? { answerCheckExpr: draft.answerCheckExpr } : {}),
    },
    status: 'AI_GENERATED',
  };
  if (!template) return { item };
  return {
    item,
    template: {
      item: slot.id,
      params: template.params.map(param),
      constraints: template.constraints,
      answerExpr: template.answerExpr,
      distractorExprs: template.distractorExprs,
      render: {
        stem: template.stem,
        ...(template.explanation ? { explanation: template.explanation } : {}),
      },
    },
  };
}

/** What the verifier sees: no key, no worked solution, no feedback. Templates as one variant. */
export function blindView(item: PackageItem, template?: ItemTemplate, seed = 1) {
  let stemMd = item.stemMd;
  let options = item.options;
  let key = item.answer;
  if (template && isTemplateItemType(item.type)) {
    const variant = renderVariant({ ...template, type: item.type }, seed);
    if (variant.ok) {
      stemMd = variant.value.stemMd;
      options = variant.value.options;
      key = variant.value.answer;
    }
  }
  return {
    view: {
      code: item.code,
      type: item.type,
      level: item.cognitiveLevel,
      stemMd,
      options: options.map((o) => ({ id: o.id, text: o.text ?? '', side: o.side ?? null })),
      hints: item.hints.map((h) => h.md),
      media: item.media,
    },
    key,
  };
}
