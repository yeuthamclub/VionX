// Library package upload (POST /admin/library/import with the zip as the raw body).
import type { ApiClient } from '@vionx/contracts/client';
import { apiErrorText } from './edit.ts';
import type { EntityDiff, ImportDiff, ImportResult, PackageIssue } from './types.ts';

/** Same limit as the api (MAX_PACKAGE_BYTES). */
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;

/** Client-side check before upload; null when the file looks like a package zip. */
export function checkPackageFile(file: { name: string; size: number }): string | null {
  if (!file.name.toLowerCase().endsWith('.zip')) return 'Choose the package as a .zip file.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_PACKAGE_BYTES) return 'The package is larger than 20 MB.';
  return null;
}

export type ImportOutcome =
  | { kind: 'ok'; result: ImportResult }
  | { kind: 'invalid'; message: string; errors: PackageIssue[]; warnings: PackageIssue[] }
  | { kind: 'error'; message: string };

const issues = (value: unknown): PackageIssue[] =>
  Array.isArray(value)
    ? value.map((v: Partial<PackageIssue> | string) =>
        typeof v === 'string'
          ? { code: 'ERROR', message: v }
          : { code: v.code ?? 'ERROR', message: v.message ?? String(v), ref: v.ref },
      )
    : [];

/** Sends the zip unchanged (no JSON serialisation) and sorts the answer into ok / invalid / error. */
export async function importPackage(
  client: ApiClient,
  file: Blob,
  mode: 'dry-run' | 'apply',
): Promise<ImportOutcome> {
  const { data, error, response } = await client.POST('/api/v1/admin/library/import', {
    params: { query: { mode } },
    body: file as unknown as string,
    headers: { 'content-type': 'application/zip' },
    bodySerializer: (body: unknown) => body as BodyInit,
  });
  if (data) return { kind: 'ok', result: data };
  const body = error as { code?: string; message?: string; details?: unknown } | undefined;
  if (response.status === 422 && body?.code === 'PACKAGE_INVALID') {
    const details = (body.details ?? {}) as { errors?: unknown; warnings?: unknown };
    return {
      kind: 'invalid',
      message: body.message ?? 'Package is invalid',
      errors: issues(details.errors),
      warnings: issues(details.warnings),
    };
  }
  return { kind: 'error', message: apiErrorText(body, response.status) };
}

export const DIFF_ENTITIES = [
  'nodes',
  'edges',
  'series',
  'mappings',
  'media',
  'groups',
  'items',
  'templates',
] as const satisfies readonly (keyof ImportDiff)[];

export interface DiffRow {
  entity: keyof ImportDiff;
  added: string[];
  updated: string[];
  archived: string[];
  restored: string[];
  unchanged: number;
}

const EMPTY: EntityDiff = { added: [], updated: [], archived: [], restored: [], unchanged: 0 };

/** One row per entity in package order, plus whether anything would change. */
export function diffRows(diff: ImportDiff): { rows: DiffRow[]; changes: number } {
  const rows = DIFF_ENTITIES.map((entity) => ({ entity, ...EMPTY, ...diff[entity] }));
  const changes = rows.reduce(
    (n, r) => n + r.added.length + r.updated.length + r.archived.length + r.restored.length,
    0,
  );
  return { rows, changes };
}

/** `0.3` → `30%`. */
export const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;
