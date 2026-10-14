import { describe, expect, it } from 'vitest';
import { branchIds, buildTree } from './tree.ts';

const n = (id: string, parentId: string | null, sortOrder = 0, code = id) => ({
  id,
  parentId,
  code,
  sortOrder,
});

describe('buildTree', () => {
  it('nests by parentId and orders siblings by sortOrder then code', () => {
    const roots = buildTree([
      n('s2', 't1', 2),
      n('g', null),
      n('t1', 'g'),
      n('s1', 't1', 1),
      n('s0', 't1', 1, 'A'),
    ]);
    expect(roots.map((r) => r.id)).toEqual(['g']);
    const topic = roots[0]!.children[0]!;
    expect(topic.id).toBe('t1');
    expect(topic.children.map((c) => c.id)).toEqual(['s0', 's1', 's2']);
  });

  it('keeps nodes whose parent is missing as roots', () => {
    const roots = buildTree([n('a', 'missing'), n('b', null, 1)]);
    expect(roots.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('lists branch ids', () => {
    const roots = buildTree([n('g', null), n('t', 'g'), n('s', 't')]);
    expect(branchIds(roots)).toEqual(['g', 't']);
  });
});
