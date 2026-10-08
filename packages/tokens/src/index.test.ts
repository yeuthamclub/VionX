import { describe, expect, it } from 'vitest';
import { colors, toCssVariables } from './index.ts';

describe('tokens', () => {
  it('light and dark schemes define the same keys', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });

  it('exports CSS variables in kebab case', () => {
    const vars = toCssVariables(colors.light);
    expect(vars['--vx-primary-pressed']).toBe(colors.light.primaryPressed);
    expect(vars['--vx-space-lg']).toBe('16px');
  });
});
