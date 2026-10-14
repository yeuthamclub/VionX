import { createApiClient } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import { checkPackageFile, diffRows, importPackage, percent } from './upload.ts';

const diff = (added: string[] = [], unchanged = 0) => ({
  added,
  updated: [],
  archived: [],
  restored: [],
  unchanged,
});

function clientAnswering(status: number, body: unknown, seen: Request[]) {
  return createApiClient({
    baseUrl: 'http://api.test/functions/v1',
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
}

describe('package upload', () => {
  it('checks the file before upload', () => {
    expect(checkPackageFile({ name: 'math-6.zip', size: 10 })).toBeNull();
    expect(checkPackageFile({ name: 'math-6.json', size: 10 })).toMatch(/\.zip/);
    expect(checkPackageFile({ name: 'a.ZIP', size: 0 })).toMatch(/empty/);
    expect(checkPackageFile({ name: 'a.zip', size: 21 * 1024 * 1024 })).toMatch(/20 MB/);
  });

  it('posts the raw zip with the mode', async () => {
    const seen: Request[] = [];
    const result = { importId: 'r1', mode: 'DRY_RUN', applied: false };
    const client = clientAnswering(200, result, seen);
    const zip = new Blob([new Uint8Array([0x50, 0x4b, 3, 4])], { type: 'application/zip' });
    const outcome = await importPackage(client, zip, 'dry-run');
    expect(outcome).toEqual({ kind: 'ok', result });
    const req = seen[0]!;
    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toBe('/functions/v1/api/v1/admin/library/import');
    expect(new URL(req.url).searchParams.get('mode')).toBe('dry-run');
    expect(req.headers.get('content-type')).toBe('application/zip');
    expect([...new Uint8Array(await req.arrayBuffer())]).toEqual([0x50, 0x4b, 3, 4]);
  });

  it('returns validation errors of an invalid package', async () => {
    const client = clientAnswering(
      422,
      {
        code: 'PACKAGE_INVALID',
        message: 'Package is invalid: cycle',
        requestId: 'x',
        details: {
          errors: [{ code: 'EDGE_CYCLE', message: 'A → B → A', ref: 'edges.json' }],
          warnings: [{ code: 'LOW_COVERAGE', message: 'few items' }],
        },
      },
      [],
    );
    expect(await importPackage(client, new Blob(['x']), 'apply')).toEqual({
      kind: 'invalid',
      message: 'Package is invalid: cycle',
      errors: [{ code: 'EDGE_CYCLE', message: 'A → B → A', ref: 'edges.json' }],
      warnings: [{ code: 'LOW_COVERAGE', message: 'few items', ref: undefined }],
    });
  });

  it('reports other failures as a message', async () => {
    const client = clientAnswering(
      403,
      { code: 'FORBIDDEN', message: 'Missing permission', requestId: 'x' },
      [],
    );
    expect(await importPackage(client, new Blob(['x']), 'dry-run')).toEqual({
      kind: 'error',
      message: 'Missing permission',
    });
  });

  it('summarises the diff per entity', () => {
    const { rows, changes } = diffRows({
      nodes: diff(['A', 'B'], 3),
      edges: diff(),
      series: diff(),
      mappings: diff(),
      media: diff(),
      groups: diff(),
      items: { ...diff([], 5), archived: ['I1'] },
      templates: diff(),
    });
    expect(rows.map((r) => r.entity)).toEqual([
      'nodes',
      'edges',
      'series',
      'mappings',
      'media',
      'groups',
      'items',
      'templates',
    ]);
    expect(rows[0]).toMatchObject({ added: ['A', 'B'], unchanged: 3 });
    expect(changes).toBe(3);
    expect(percent(0.3)).toBe('30%');
    expect(percent(0.1234)).toBe('12.3%');
  });
});
