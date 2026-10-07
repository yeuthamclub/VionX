import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { _setCatalog, setLocale, t } from './index.ts';
import { vi } from './vi.ts';

afterEach(() => {
  _setCatalog('vi', vi);
  setLocale('vi');
});

describe('i18n', () => {
  it('defaults to Vietnamese', () => {
    expect(t('welcome.parent')).toBe('Phụ huynh');
    expect(t('welcome.child')).toBe('Con');
  });

  it('falls back to English for keys missing in Vietnamese', () => {
    _setCatalog('vi', { 'welcome.parent': 'Phụ huynh' });
    expect(t('health.retry')).toBe('Retry');
  });

  it('switches locale', () => {
    setLocale('en');
    expect(t('welcome.parent')).toBe('Parent');
  });

  it('has an English string for every Vietnamese key', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
  });
});
