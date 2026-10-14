// Small file helpers for the work dir: JSON, JSONL, atomic writes.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const readJsonIf = <T>(path: string): T | undefined =>
  existsSync(path) ? readJson<T>(path) : undefined;

export const writeJson = (path: string, value: unknown) =>
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export const writeJsonl = (path: string, rows: unknown[]) =>
  writeFileAtomic(path, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
