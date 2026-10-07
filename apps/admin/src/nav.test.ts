import { describe, expect, it } from 'vitest';
import { NAV, navLeaves } from './nav.ts';

describe('admin navigation (Master Spec §33.1)', () => {
  it('has the top-level sections in spec order', () => {
    expect(NAV.map((e) => e.label)).toEqual([
      'Dashboard',
      'Library',
      'Curriculum',
      'Knowledge Graph',
      'Learning Content',
      'AI Factory',
      'Students',
      'Competitions',
      'Analytics',
      'Privacy & Audit',
      'System',
    ]);
  });

  it('uses unique absolute paths', () => {
    const paths = navLeaves().map((l) => l.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((p) => p.startsWith('/'))).toBe(true);
    expect(paths).toHaveLength(25);
  });
});
