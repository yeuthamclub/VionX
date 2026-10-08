import { en } from './en.ts';
import { vi } from './vi.ts';

export type Locale = 'vi' | 'en';
export type MessageKey = keyof typeof en;

const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { vi, en };

let current: Locale = 'vi';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** Translate: current locale, then English, then the key itself. `{name}` placeholders. */
export function t(key: MessageKey, params?: Record<string, string | number>, locale = current) {
  const template = catalogs[locale][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Test hook: register a partial catalog (e.g. a locale missing keys). */
export function _setCatalog(locale: Locale, catalog: Partial<Record<MessageKey, string>>) {
  catalogs[locale] = catalog;
}
