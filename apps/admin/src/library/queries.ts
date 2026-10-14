// Calls to the admin library API (M05). Every query key starts with 'library' so one
// invalidation refreshes all library screens after an import or a save.
import { api } from '../api.ts';
import { apiErrorText, type ItemFilters } from './edit.ts';
import type { ContentStatus, GroupPatch, ItemDetail, ItemPatch } from './types.ts';

/** Throws a readable error for a failed openapi-fetch call, else returns its data. */
function unwrap<T>(res: { data?: T; error?: unknown; response: Response }): T {
  if (res.data === undefined) throw new Error(apiErrorText(res.error, res.response.status));
  return res.data;
}

export const libraryKeys = {
  all: ['library'] as const,
  overview: ['library', 'overview'] as const,
  imports: ['library', 'imports'] as const,
  curriculum: (version: string, grade: number, subject: string) =>
    ['library', 'curriculum', version, grade, subject] as const,
  coverage: (version: string, grade: number, subject: string) =>
    ['library', 'coverage', version, grade, subject] as const,
  items: (filters: ItemFilters) => ['library', 'items', filters] as const,
  item: (id: string) => ['library', 'item', id] as const,
  groups: (filters: GroupFilters) => ['library', 'groups', filters] as const,
  group: (id: string) => ['library', 'group', id] as const,
};

export const fetchOverview = async () => unwrap(await api.GET('/api/v1/admin/library'));

export const fetchImports = async () => unwrap(await api.GET('/api/v1/admin/library/imports')).runs;

export const fetchCurriculum = async (version: string, grade: number, subject: string) =>
  unwrap(
    await api.GET('/api/v1/admin/library/curriculum', {
      params: { query: { version, grade, subject } },
    }),
  );

export const fetchCoverage = async (version: string, grade: number, subject: string) =>
  unwrap(
    await api.GET('/api/v1/admin/library/coverage', {
      params: { query: { version, grade, subject } },
    }),
  );

export const fetchItems = async (filters: ItemFilters, cursor: string | undefined) =>
  unwrap(
    await api.GET('/api/v1/admin/library/items', {
      params: { query: { ...filters, ...(cursor ? { cursor } : {}), limit: 50 } },
    }),
  );

// openapi-fetch widens the `pairs` answer tuple to string[][]; the body is an ItemDetail.
export const fetchItem = async (id: string) =>
  unwrap(
    await api.GET('/api/v1/admin/library/items/{id}', { params: { path: { id } } }),
  ) as ItemDetail;

export const patchItem = async (id: string, patch: ItemPatch) =>
  unwrap(
    await api.PATCH('/api/v1/admin/library/items/{id}', { params: { path: { id } }, body: patch }),
  ) as ItemDetail;

export const fetchVariant = async (id: string, seed: number) =>
  unwrap(
    await api.GET('/api/v1/admin/library/items/{id}/variant', {
      params: { path: { id }, query: { seed } },
    }),
  );

export interface GroupFilters {
  grade?: number;
  subject?: string;
  status?: ContentStatus;
}

export const fetchGroups = async (filters: GroupFilters) =>
  unwrap(await api.GET('/api/v1/admin/library/groups', { params: { query: filters } })).groups;

export const fetchGroup = async (id: string) =>
  unwrap(await api.GET('/api/v1/admin/library/groups/{id}', { params: { path: { id } } }));

export const patchGroup = async (id: string, patch: GroupPatch) =>
  unwrap(
    await api.PATCH('/api/v1/admin/library/groups/{id}', {
      params: { path: { id } },
      body: patch,
    }),
  );
