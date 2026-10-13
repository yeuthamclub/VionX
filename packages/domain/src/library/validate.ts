// Package rules (TASK_PACKS/M05.md "Rules"): references resolve, no PREREQUISITE_OF cycles, no
// orphan skills, sourced groups carry a source note, answers fit their item type, templates are 1:1
// with TEMPLATE items and render, SVG media sanitise.
import { sanitizeSvg } from './svg.ts';
import {
  HINT_LADDER_LENGTH,
  NODE_LEVELS,
  type ItemAnswer,
  type LibraryPackage,
  type PackageIssue,
  type PackageItem,
} from './types.ts';
import { isTemplateItemType, probeTemplate } from './variants.ts';

/** Seeds probed per template during validation (the property tests run 10,000). */
export const VALIDATION_SEEDS = 200;

export interface PackageValidation {
  errors: PackageIssue[];
  warnings: PackageIssue[];
  /** Sanitised SVG per media code (kind SVG). */
  sanitisedSvg: Record<string, string>;
}

const levelIndex = (level: string) => (NODE_LEVELS as readonly string[]).indexOf(level);

function duplicates(codes: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const code of codes) (seen.has(code) ? dup : seen).add(code);
  return [...dup];
}

/**
 * Finds a cycle among PREREQUISITE_OF edges (iterative DFS). Returns the cycle as a code path
 * that starts and ends on the same node, or null.
 */
export function findPrerequisiteCycle(edges: { from: string; to: string }[]): string[] | null {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, 'open' | 'done'>();
  for (const start of [...next.keys()].sort()) {
    if (state.has(start)) continue;
    const path: string[] = [];
    const stack: { node: string; i: number }[] = [{ node: start, i: 0 }];
    state.set(start, 'open');
    path.push(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const children = next.get(top.node) ?? [];
      if (top.i >= children.length) {
        state.set(top.node, 'done');
        stack.pop();
        path.pop();
        continue;
      }
      const child = children[top.i++]!;
      const s = state.get(child);
      if (s === 'open') return [...path.slice(path.indexOf(child)), child];
      if (s === undefined) {
        state.set(child, 'open');
        stack.push({ node: child, i: 0 });
        path.push(child);
      }
    }
  }
  return null;
}

const CHOICE_ANSWER_TYPES = ['single_choice', 'picture_choice', 'spelling_choice'];

/** Checks the answer shape for the item type and that option ids it names exist. */
export function answerProblem(
  item: Pick<PackageItem, 'type' | 'options' | 'answer'>,
): string | null {
  const ids = new Set(item.options.map((o) => o.id));
  const a = item.answer as Record<string, unknown> | null;
  const has = (key: string) => a !== null && key in a;
  const known = (id: unknown) => typeof id === 'string' && ids.has(id);
  if (item.type === 'written')
    return a === null ? null : 'written items have no answer (rubric only)';
  if (a === null) return 'answer is missing';
  switch (item.type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      return has('optionId') && known(a.optionId) ? null : 'answer.optionId must name an option';
    case 'multi_choice': {
      const list = a.optionIds;
      return Array.isArray(list) &&
        list.length > 0 &&
        list.every(known) &&
        new Set(list).size === list.length
        ? null
        : 'answer.optionIds must name at least one option, without repeats';
    }
    case 'numeric':
      return typeof a.value === 'number' && Number.isFinite(a.value)
        ? null
        : 'answer.value must be a number';
    case 'true_false':
      return typeof a.value === 'boolean' ? null : 'answer.value must be true or false';
    case 'fill_blank': {
      const blanks = a.blanks;
      return Array.isArray(blanks) &&
        blanks.length > 0 &&
        blanks.every(
          (b) =>
            Array.isArray(b) &&
            b.length > 0 &&
            b.every((s) => typeof s === 'string' && s.trim() !== ''),
        )
        ? null
        : 'answer.blanks must list accepted text for every blank';
    }
    case 'word_bank': {
      const list = a.blankOptionIds;
      return Array.isArray(list) && list.length > 0 && list.every(known)
        ? null
        : 'answer.blankOptionIds must name an option for every blank';
    }
    case 'ordering': {
      const order = a.order;
      return Array.isArray(order) &&
        order.length === ids.size &&
        order.every(known) &&
        new Set(order).size === ids.size
        ? null
        : 'answer.order must list every option exactly once';
    }
    case 'matching': {
      const pairs = a.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0)
        return 'answer.pairs must list the matching pairs';
      const left = new Set(item.options.filter((o) => o.side === 'left').map((o) => o.id));
      const right = new Set(item.options.filter((o) => o.side === 'right').map((o) => o.id));
      const ok = pairs.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          left.has(p[0] as string) &&
          right.has(p[1] as string),
      );
      return ok && pairs.length === left.size
        ? null
        : 'answer.pairs must pair every left option with a right option';
    }
  }
}

/** Cheap structural checks for an answer the admin edits (same rules as import). */
export const isAnswerValid = (item: {
  type: PackageItem['type'];
  options: PackageItem['options'];
  answer: ItemAnswer | null;
}) => answerProblem(item) === null;

export function validateLibraryPackage(
  pkg: LibraryPackage,
  options: { templateSeeds?: number } = {},
): PackageValidation {
  const errors: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];
  const error = (code: string, message: string, ref?: string) =>
    errors.push({ code, message, ref });
  const warn = (code: string, message: string, ref?: string) =>
    warnings.push({ code, message, ref });
  const { manifest } = pkg;

  // --- Uniqueness ---
  const uniqueChecks: [string, string[]][] = [
    ['curriculum node', pkg.curriculum.nodes.map((n) => n.code)],
    ['book series', pkg.mappings.series.map((s) => s.code)],
    ['media', pkg.media.map((m) => m.code)],
    ['group', pkg.groups.map((g) => g.code)],
    ['item', pkg.items.map((i) => i.code)],
    ['template', pkg.templates.map((t) => t.item)],
  ];
  for (const [what, codes] of uniqueChecks) {
    for (const code of duplicates(codes))
      error('DUPLICATE_CODE', `${what} code ${code} appears more than once`, code);
  }

  if (manifest.curriculumVersion !== pkg.curriculum.version.code) {
    error(
      'VERSION_MISMATCH',
      `manifest curriculumVersion ${manifest.curriculumVersion} differs from curriculum.json ${pkg.curriculum.version.code}`,
    );
  }

  // --- Curriculum tree ---
  const nodes = new Map(pkg.curriculum.nodes.map((n) => [n.code, n]));
  const subjects = pkg.curriculum.nodes.filter((n) => n.level === 'SUBJECT');
  if (subjects.length !== 1) {
    error('SUBJECT_NODE', `a package has exactly one SUBJECT node (found ${subjects.length})`);
  }
  for (const node of pkg.curriculum.nodes) {
    if (node.level === 'GRADE') {
      if (node.parent !== null)
        error('GRADE_PARENT', `GRADE node ${node.code} has no parent`, node.code);
      continue;
    }
    if (node.parent === null) {
      error('MISSING_PARENT', `${node.level} node ${node.code} needs a parent`, node.code);
      continue;
    }
    const parent = nodes.get(node.parent);
    if (!parent) {
      error(
        'UNKNOWN_PARENT',
        `node ${node.code}: parent ${node.parent} is not in curriculum.json`,
        node.code,
      );
    } else if (levelIndex(parent.level) >= levelIndex(node.level)) {
      error(
        'LEVEL_ORDER',
        `node ${node.code} (${node.level}) sits under ${parent.code} (${parent.level})`,
        node.code,
      );
    }
  }
  const subjectCode = subjects[0]?.code;
  // Orphan skill: a SKILL whose parent chain does not reach the package's SUBJECT node.
  for (const node of pkg.curriculum.nodes) {
    if (node.level !== 'SKILL') continue;
    let current = node;
    const seen = new Set<string>();
    let reached = false;
    while (current.parent !== null && !seen.has(current.code)) {
      seen.add(current.code);
      if (current.parent === subjectCode) {
        reached = true;
        break;
      }
      const parent = nodes.get(current.parent);
      if (!parent) break;
      current = parent;
    }
    if (!reached)
      error(
        'ORPHAN_SKILL',
        `skill ${node.code} is not under the subject node ${subjectCode ?? '(none)'}`,
        node.code,
      );
  }

  // --- Edges ---
  for (const edge of pkg.edges) {
    const ref = `${edge.from} → ${edge.to}`;
    if (!nodes.has(edge.from))
      error('UNKNOWN_NODE', `edge ${ref}: ${edge.from} is not in curriculum.json`, ref);
    if (!nodes.has(edge.to))
      error('UNKNOWN_NODE', `edge ${ref}: ${edge.to} is not in curriculum.json`, ref);
    if (edge.from === edge.to) error('SELF_EDGE', `edge ${ref} points at itself`, ref);
  }
  const cycle = findPrerequisiteCycle(pkg.edges.filter((e) => e.type === 'PREREQUISITE_OF'));
  if (cycle) {
    error(
      'PREREQUISITE_CYCLE',
      `PREREQUISITE_OF edges form a cycle: ${cycle.join(' → ')}`,
      cycle[0],
    );
  }

  // --- Mappings ---
  const series = new Set(pkg.mappings.series.map((s) => s.code));
  for (const m of pkg.mappings.mappings) {
    const ref = `${m.series}/${m.lessonRef}`;
    if (!series.has(m.series))
      error('UNKNOWN_SERIES', `mapping ${ref}: series ${m.series} is not listed`, ref);
    if (!nodes.has(m.node))
      error('UNKNOWN_NODE', `mapping ${ref}: node ${m.node} is not in curriculum.json`, ref);
    if (m.pageStart !== undefined && m.pageEnd !== undefined && m.pageEnd < m.pageStart) {
      error('PAGE_RANGE', `mapping ${ref}: pageEnd is before pageStart`, ref);
    }
  }

  // --- Media ---
  const media = new Set(pkg.media.map((m) => m.code));
  const sanitisedSvg: Record<string, string> = {};
  for (const m of pkg.media) {
    if (m.kind === 'SVG') {
      const source = m.file ? pkg.svgFiles[m.file] : undefined;
      if (source === undefined) {
        error(
          'MISSING_MEDIA_FILE',
          `media ${m.code}: file media/${m.file ?? '(none)'} is missing`,
          m.code,
        );
        continue;
      }
      const clean = sanitizeSvg(source);
      if (!clean.ok) {
        error('INVALID_SVG', `media ${m.code}: ${clean.message ?? 'invalid SVG'}`, m.code);
        continue;
      }
      if (clean.value.removed.length > 0) {
        warn('SVG_SANITISED', `media ${m.code}: removed ${clean.value.removed.join(', ')}`, m.code);
      }
      sanitisedSvg[m.code] = clean.value.svg;
    } else if (!m.storagePath) {
      error('MISSING_STORAGE_PATH', `media ${m.code}: ${m.kind} media need a storagePath`, m.code);
    }
  }

  // --- Groups ---
  const groups = new Set(pkg.groups.map((g) => g.code));
  for (const g of pkg.groups) {
    if (g.sourceKind !== 'ORIGINAL_AI' && !g.sourceNote?.trim()) {
      error(
        'SOURCE_NOTE_REQUIRED',
        `group ${g.code}: ${g.sourceKind} groups need a sourceNote`,
        g.code,
      );
    }
    for (const code of g.media) {
      if (!media.has(code))
        error('UNKNOWN_MEDIA', `group ${g.code}: media ${code} is not listed`, g.code);
    }
  }

  // --- Items ---
  const templates = new Map(pkg.templates.map((t) => [t.item, t]));
  const groupOrders = new Map<string, Set<number>>();
  for (const item of pkg.items) {
    const ref = item.code;
    for (const skill of item.skills) {
      const node = nodes.get(skill);
      if (!node)
        error('UNKNOWN_SKILL', `item ${ref}: skill ${skill} is not in curriculum.json`, ref);
      else if (node.level !== 'SKILL')
        error('NOT_A_SKILL', `item ${ref}: ${skill} is a ${node.level}, not a SKILL`, ref);
    }
    const optionIds = item.options.map((o) => o.id);
    for (const id of duplicates(optionIds))
      error('DUPLICATE_OPTION', `item ${ref}: option id ${id} repeats`, ref);
    for (const code of item.media) {
      if (!media.has(code)) error('UNKNOWN_MEDIA', `item ${ref}: media ${code} is not listed`, ref);
    }
    for (const o of item.options) {
      if (o.media !== undefined && !media.has(o.media)) {
        error('UNKNOWN_MEDIA', `item ${ref}: option ${o.id} uses unknown media ${o.media}`, ref);
      }
    }
    if (item.hints.length !== HINT_LADDER_LENGTH) {
      error(
        'HINT_LADDER',
        `item ${ref}: needs exactly ${HINT_LADDER_LENGTH} hints (has ${item.hints.length})`,
        ref,
      );
    }
    if (item.type === 'written' && !item.rubric)
      error('RUBRIC_REQUIRED', `item ${ref}: written items need a rubric`, ref);
    if (item.type !== 'written' && item.rubric)
      error('RUBRIC_UNEXPECTED', `item ${ref}: only written items have a rubric`, ref);

    if (item.kind === 'TEMPLATE') {
      if (!isTemplateItemType(item.type)) {
        error('TEMPLATE_TYPE', `item ${ref}: type ${item.type} cannot be a TEMPLATE item`, ref);
      }
      if (!templates.has(item.code))
        error('MISSING_TEMPLATE', `item ${ref}: TEMPLATE item without templates.jsonl entry`, ref);
    } else {
      if (templates.has(item.code))
        error('UNEXPECTED_TEMPLATE', `item ${ref}: STATIC item has a template`, ref);
      const problem = answerProblem(item);
      if (problem) error('ANSWER_SHAPE', `item ${ref}: ${problem}`, ref);
      for (const key of Object.keys(item.distractorFeedback)) {
        if (!optionIds.includes(key))
          error(
            'UNKNOWN_OPTION',
            `item ${ref}: distractor feedback for unknown option ${key}`,
            ref,
          );
      }
      if (CHOICE_ANSWER_TYPES.includes(item.type) && item.options.length < 2) {
        error('TOO_FEW_OPTIONS', `item ${ref}: choice items need at least 2 options`, ref);
      }
    }

    if (item.group !== undefined) {
      if (!groups.has(item.group))
        error('UNKNOWN_GROUP', `item ${ref}: group ${item.group} is not in groups.jsonl`, ref);
      if (item.groupOrder === undefined)
        error('GROUP_ORDER', `item ${ref}: groupOrder is required with a group`, ref);
      else {
        const orders = groupOrders.get(item.group) ?? new Set<number>();
        if (orders.has(item.groupOrder))
          error(
            'GROUP_ORDER',
            `item ${ref}: groupOrder ${item.groupOrder} repeats in ${item.group}`,
            ref,
          );
        orders.add(item.groupOrder);
        groupOrders.set(item.group, orders);
      }
    } else if (item.groupOrder !== undefined) {
      error('GROUP_ORDER', `item ${ref}: groupOrder without a group`, ref);
    }
  }
  const itemsByCode = new Map(pkg.items.map((i) => [i.code, i]));
  for (const g of pkg.groups) {
    if (!groupOrders.has(g.code)) warn('EMPTY_GROUP', `group ${g.code} has no items`, g.code);
  }

  // --- Templates ---
  const seeds = options.templateSeeds ?? VALIDATION_SEEDS;
  for (const template of pkg.templates) {
    const item = itemsByCode.get(template.item);
    if (!item) {
      error('UNKNOWN_ITEM', `template for ${template.item}: no such item`, template.item);
      continue;
    }
    if (item.kind !== 'TEMPLATE' || !isTemplateItemType(item.type)) continue;
    const probe = probeTemplate({ ...template, type: item.type }, seeds);
    if (!probe.ok) {
      error(
        probe.error === 'CONSTRAINTS_UNSATISFIABLE' ? 'TEMPLATE_UNSATISFIABLE' : 'TEMPLATE_INVALID',
        `template ${template.item} (seed ${probe.seed}): ${probe.message ?? probe.error}`,
        template.item,
      );
    }
  }

  // --- Skills without items (coverage, not an error) ---
  const covered = new Set(pkg.items.flatMap((i) => i.skills));
  for (const node of pkg.curriculum.nodes) {
    if (node.level === 'SKILL' && !covered.has(node.code)) {
      warn(
        'SKILL_WITHOUT_ITEMS',
        `skill ${node.code} has no items (inactive until it has 2 approved)`,
        node.code,
      );
    }
  }

  return { errors, warnings, sanitisedSvg };
}
