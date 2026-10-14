// Response/request types of the admin library API (M05), taken from the generated OpenAPI paths.
import type { ApiPaths } from '@vionx/contracts/client';

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;
type Admin = '/api/v1/admin/library';

export type LibraryOverview = Json<ApiPaths[Admin]['get']['responses'][200]>;
export type LibrarySummary = LibraryOverview['libraries'][number];
export type SubjectProfile = LibraryOverview['profiles'][number];
export type ImportResult = Json<ApiPaths[`${Admin}/import`]['post']['responses'][200]>;
export type ImportDiff = ImportResult['diff'];
export type EntityDiff = ImportDiff['nodes'];
export type PackageIssue = ImportResult['warnings'][number];
export type CoverageReport = ImportResult['coverage'];
export type ImportRun = Json<ApiPaths[`${Admin}/imports`]['get']['responses'][200]>['runs'][number];
export type CurriculumResponse = Json<ApiPaths[`${Admin}/curriculum`]['get']['responses'][200]>;
export type CurriculumNode = CurriculumResponse['nodes'][number];
export type CoverageResponse = Json<ApiPaths[`${Admin}/coverage`]['get']['responses'][200]>;
export type ItemListResponse = Json<ApiPaths[`${Admin}/items`]['get']['responses'][200]>;
export type ItemSummary = ItemListResponse['items'][number];
export type ItemDetail = Json<ApiPaths[`${Admin}/items/{id}`]['get']['responses'][200]>;
export type ItemPatch = NonNullable<
  ApiPaths[`${Admin}/items/{id}`]['patch']
>['requestBody']['content']['application/json'];
export type ItemVariant = Json<ApiPaths[`${Admin}/items/{id}/variant`]['get']['responses'][200]>;
export type MediaAsset = ItemDetail['media'][number];
export type ItemGroup = NonNullable<
  Json<ApiPaths[`${Admin}/groups`]['get']['responses'][200]>['groups'][number]
>;
export type GroupDetail = Json<ApiPaths[`${Admin}/groups/{id}`]['get']['responses'][200]>;
export type GroupPatch = NonNullable<
  ApiPaths[`${Admin}/groups/{id}`]['patch']
>['requestBody']['content']['application/json'];
export type ContentStatus = ItemSummary['status'];
export type ItemKind = ItemSummary['kind'];
export type ItemType = ItemSummary['type'];
export type CognitiveLevel = ItemSummary['cognitiveLevel'];

export const CONTENT_STATUSES = [
  'DRAFT',
  'AI_GENERATED',
  'VALIDATING',
  'NEEDS_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
] as const satisfies readonly ContentStatus[];
export const ITEM_KINDS = ['STATIC', 'TEMPLATE'] as const satisfies readonly ItemKind[];
export const ITEM_TYPES = [
  'single_choice',
  'multi_choice',
  'numeric',
  'fill_blank',
  'word_bank',
  'picture_choice',
  'ordering',
  'matching',
  'true_false',
  'spelling_choice',
  'written',
] as const satisfies readonly ItemType[];
export const COGNITIVE_LEVELS = [
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
] as const satisfies readonly CognitiveLevel[];
export const STIMULUS_KINDS = [
  'PASSAGE',
  'POEM',
  'DIALOGUE',
  'PICTURE_SCENE',
  'EXPERIMENT',
] as const satisfies readonly NonNullable<GroupPatch['stimulusKind']>[];
export const SOURCE_KINDS = [
  'ORIGINAL_AI',
  'PUBLIC_DOMAIN',
  'LICENSED',
] as const satisfies readonly NonNullable<GroupPatch['sourceKind']>[];

/** Library permissions (D11). SUPER_ADMIN implies all (see access.ts). */
export const LIBRARY_READ = ['CONTENT_ADMIN', 'CURRICULUM_EDITOR', 'CONTENT_REVIEWER', 'LIBRARIAN'];
export const LIBRARY_EDIT = ['CONTENT_ADMIN', 'CONTENT_REVIEWER'];
export const LIBRARY_IMPORT = ['CONTENT_ADMIN'];
