// review.csv round trip (TASK_PACKS/X01.md step 11). One row per item; the reviewer fills
// `verdict` (APPROVED / REJECTED / EDITED, blank = later) and `reviewer_note`. For EDITED rows the
// editable columns are read back; everything else is for reading only.
import {
  isTemplateItemType,
  renderVariant,
  type ItemTemplate,
  type PackageItem,
} from '@vionx/domain';
import { parseAnswerJson } from './answers.ts';
import { parseCsv, toCsv } from './csv.ts';

export const REVIEW_HEADER = [
  'code',
  'skill',
  'level',
  'kind',
  'type',
  'auto_verdict',
  'flags',
  'stem_md',
  'options_json',
  'answer_json',
  'hint_1',
  'hint_2',
  'hint_3',
  'hint_4',
  'explanation_md',
  'worked_solution_md',
  'distractor_feedback_json',
  'template_json',
  'sample_variants',
  'figure',
  'verifier_note',
  'dispute_note',
  'verdict',
  'reviewer_note',
] as const;

export const EDITABLE = [
  'stem_md',
  'options_json',
  'answer_json',
  'hint_1',
  'hint_2',
  'hint_3',
  'hint_4',
  'explanation_md',
  'worked_solution_md',
  'distractor_feedback_json',
  'template_json',
] as const;

export const VERDICTS = ['APPROVED', 'REJECTED', 'EDITED'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface ReviewRowInput {
  item: PackageItem;
  template?: ItemTemplate;
  autoVerdict: string;
  flags: string[];
  figureLink?: string;
  verifierNote?: string;
  disputeNote?: string;
}

const json = (v: unknown) => JSON.stringify(v);

function samples(item: PackageItem, template?: ItemTemplate): string {
  if (!template || !isTemplateItemType(item.type)) return '';
  return [1, 2, 3]
    .map((seed) => {
      const v = renderVariant({ ...template, type: item.type }, seed);
      if (!v.ok) return `seed ${seed}: ${v.error}`;
      const options = v.value.options.length
        ? ` [${v.value.options.map((o) => `${o.id}) ${o.text}`).join('; ')}]`
        : '';
      return `seed ${seed}: ${v.value.stemMd}${options} → ${String(v.value.answerValue)}`;
    })
    .join('\n');
}

export function reviewRow(r: ReviewRowInput): Record<string, string> {
  const { item, template } = r;
  const { params, constraints, answerExpr, distractorExprs, render } =
    template ?? ({} as Partial<ItemTemplate>);
  return {
    code: item.code,
    skill: item.skills.join(' '),
    level: item.cognitiveLevel,
    kind: item.kind,
    type: item.type,
    auto_verdict: r.autoVerdict,
    flags: r.flags.join('; '),
    stem_md: item.stemMd,
    options_json: item.options.length ? json(item.options) : '',
    answer_json: item.answer === null ? '' : json(item.answer),
    hint_1: item.hints[0]?.md ?? '',
    hint_2: item.hints[1]?.md ?? '',
    hint_3: item.hints[2]?.md ?? '',
    hint_4: item.hints[3]?.md ?? '',
    explanation_md: item.explanationMd,
    worked_solution_md: item.workedSolutionMd,
    distractor_feedback_json: json(item.distractorFeedback),
    template_json: template
      ? json({ params, constraints, answerExpr, distractorExprs, render })
      : '',
    sample_variants: samples(item, template),
    figure: r.figureLink ?? '',
    verifier_note: r.verifierNote ?? '',
    dispute_note: r.disputeNote ?? '',
    verdict: '',
    reviewer_note: '',
  };
}

export const reviewCsv = (rows: ReviewRowInput[]) => toCsv([...REVIEW_HEADER], rows.map(reviewRow));

export interface ReviewDecision {
  code: string;
  verdict: Verdict;
  note: string;
  /** EDITED: the item and template rebuilt from the editable columns. */
  item?: PackageItem;
  template?: ItemTemplate;
}

/**
 * Reads review.csv against the current items. Rows without a verdict are skipped. Throws with
 * every problem (unknown code, bad verdict, unparsable edited JSON) so nothing half-applies.
 */
export function readReview(
  text: string,
  current: Map<string, { item: PackageItem; template?: ItemTemplate }>,
): ReviewDecision[] {
  const { header, rows } = parseCsv(text);
  const missing = ['code', 'verdict'].filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`review.csv lacks columns: ${missing.join(', ')}`);
  const problems: string[] = [];
  const decisions: ReviewDecision[] = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    const verdict = (row.verdict ?? '').trim().toUpperCase();
    if (verdict === '') return;
    const code = (row.code ?? '').trim();
    const cur = current.get(code);
    if (!cur) return void problems.push(`line ${line}: unknown item ${code}`);
    if (!(VERDICTS as readonly string[]).includes(verdict))
      return void problems.push(
        `line ${line}: verdict must be APPROVED, REJECTED or EDITED (got ${row.verdict})`,
      );
    const note = (row.reviewer_note ?? '').trim();
    if (verdict !== 'EDITED')
      return void decisions.push({ code, verdict: verdict as Verdict, note });
    try {
      const parse = <T>(cell: string | undefined, fallback: T): T =>
        cell === undefined || cell.trim() === '' ? fallback : (JSON.parse(cell) as T);
      const item: PackageItem = {
        ...cur.item,
        stemMd: row.stem_md ?? cur.item.stemMd,
        options: parse(row.options_json, []),
        answer: cur.item.kind === 'TEMPLATE' ? null : parseAnswerJson(row.answer_json),
        hints: [row.hint_1, row.hint_2, row.hint_3, row.hint_4].map((md, k) => ({
          ...cur.item.hints[k],
          md: md ?? '',
        })),
        explanationMd: row.explanation_md ?? cur.item.explanationMd,
        workedSolutionMd: row.worked_solution_md ?? cur.item.workedSolutionMd,
        distractorFeedback: parse(row.distractor_feedback_json, {}),
      };
      let template: ItemTemplate | undefined;
      if (cur.template) {
        const t = parse<Partial<ItemTemplate>>(row.template_json, {});
        template = { ...cur.template, ...t, item: code };
      }
      decisions.push({ code, verdict: 'EDITED', note, item, ...(template ? { template } : {}) });
    } catch (e) {
      problems.push(`line ${line} (${code}): edited JSON does not parse: ${(e as Error).message}`);
    }
  });
  if (problems.length) throw new Error(`review.csv has problems:\n  ${problems.join('\n  ')}`);
  return decisions;
}
