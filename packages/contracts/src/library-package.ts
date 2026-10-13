// Library package format (TASK_PACKS/M05.md "Library package format", shared with X01-X08 and M14):
// `library/<curriculumVersion>/<grade>-<subject>/` with manifest.json, curriculum.json, edges.json,
// mappings.json, groups.jsonl, items.jsonl, templates.jsonl, media/media.jsonl + media/*.svg.
// Zod schemas here are the source of the JSON Schemas in packages/contracts/library/.
import { z } from 'zod';
import {
  COGNITIVE_LEVELS,
  CONTENT_STATUSES,
  EDGE_TYPES,
  ITEM_KINDS,
  ITEM_TYPES,
  MEDIA_KINDS,
  MEDIA_REVIEW_STATUSES,
  NODE_LEVELS,
  SOURCE_KINDS,
  STIMULUS_KINDS,
  TTS_LANGS,
  type LibraryPackage,
  type PackageIssue,
} from '@vionx/domain';

const Code = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, ".", "_" and "-" only');
const Text = z.string().min(1);
const OptionalText = z.string().optional();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const PackageManifestSchema = z
  .object({
    format: z.literal(1),
    curriculumVersion: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    grade: z.int().min(1).max(12),
    subject: z.string().regex(/^[a-z]+$/),
    title: Text,
    bookSeries: OptionalText,
    counts: z.record(z.string(), z.int().nonnegative()),
    checksums: z.record(z.string(), Sha256),
    models: z.array(z.string()),
    reviewer: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const PackageCurriculumSchema = z
  .object({
    version: z
      .object({
        code: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
        title: Text,
        academicYear: OptionalText,
        source: OptionalText,
      })
      .strict(),
    nodes: z.array(
      z
        .object({
          code: Code,
          parent: Code.nullable(),
          level: z.enum(NODE_LEVELS),
          title: Text,
          description: OptionalText,
          gdptRef: OptionalText,
          weight: z.number().nonnegative().optional(),
          sortOrder: z.int().optional(),
          status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const PackageEdgesSchema = z.array(
  z.object({ from: Code, to: Code, type: z.enum(EDGE_TYPES), reason: OptionalText }).strict(),
);

export const PackageMappingsSchema = z
  .object({
    series: z.array(
      z
        .object({ code: Code, title: Text, publisher: OptionalText, academicYear: OptionalText })
        .strict(),
    ),
    mappings: z.array(
      z
        .object({
          series: Code,
          lessonRef: Text,
          title: OptionalText,
          pageStart: z.int().positive().optional(),
          pageEnd: z.int().positive().optional(),
          node: Code,
        })
        .strict(),
    ),
  })
  .strict();

export const PackageMediaSchema = z
  .object({
    code: Code,
    kind: z.enum(MEDIA_KINDS),
    file: z
      .string()
      .regex(/^[A-Za-z0-9._-]+\.svg$/)
      .optional(),
    storagePath: OptionalText,
    alt: Text,
    license: Text,
    attribution: OptionalText,
    reviewStatus: z.enum(MEDIA_REVIEW_STATUSES),
  })
  .strict();

export const PackageGroupSchema = z
  .object({
    code: Code,
    stimulusKind: z.enum(STIMULUS_KINDS),
    title: Text,
    bodyMd: Text,
    ttsText: OptionalText,
    ttsLang: z.enum(TTS_LANGS).optional(),
    media: z.array(Code).default([]),
    wordCount: z.int().nonnegative().optional(),
    genre: OptionalText,
    sourceKind: z.enum(SOURCE_KINDS),
    sourceNote: OptionalText,
    status: z.enum(CONTENT_STATUSES),
  })
  .strict();

export const ItemOptionSchema = z
  .object({
    id: z.string().min(1).max(20),
    text: OptionalText,
    media: Code.optional(),
    ttsText: OptionalText,
    side: z.enum(['left', 'right']).optional(),
  })
  .strict();

export const ItemAnswerSchema = z.union([
  z.object({ optionId: z.string() }).strict(),
  z.object({ optionIds: z.array(z.string()) }).strict(),
  z.object({ value: z.number(), tolerance: z.number().nonnegative().optional() }).strict(),
  z.object({ blanks: z.array(z.array(z.string())) }).strict(),
  z.object({ blankOptionIds: z.array(z.string()) }).strict(),
  z.object({ order: z.array(z.string()) }).strict(),
  z.object({ pairs: z.array(z.tuple([z.string(), z.string()])) }).strict(),
  z.object({ value: z.boolean() }).strict(),
]);

export const HintSchema = z.object({ md: Text, ttsText: OptionalText }).strict();

export const RubricSchema = z
  .object({
    criteria: z
      .array(z.object({ name: Text, description: Text, maxPoints: z.int().positive() }).strict())
      .min(1),
    guidanceMd: OptionalText,
  })
  .strict();

export const PackageItemSchema = z
  .object({
    code: Code,
    kind: z.enum(ITEM_KINDS),
    skills: z.array(Code).min(1),
    difficulty: z.int().min(1).max(5),
    cognitiveLevel: z.enum(COGNITIVE_LEVELS),
    type: z.enum(ITEM_TYPES),
    stemMd: Text,
    media: z.array(Code).default([]),
    options: z.array(ItemOptionSchema).default([]),
    answer: ItemAnswerSchema.nullable(),
    explanationMd: z.string().default(''),
    hints: z.array(HintSchema),
    workedSolutionMd: z.string().default(''),
    distractorFeedback: z
      .record(z.string(), z.object({ md: Text, misconception: OptionalText }).strict())
      .default({}),
    misconceptionTags: z.array(z.string()).default([]),
    rubric: RubricSchema.nullable().optional(),
    ttsText: OptionalText,
    ttsLang: z.enum(TTS_LANGS).optional(),
    group: Code.optional(),
    groupOrder: z.int().positive().optional(),
    sourceRefs: z
      .array(z.object({ kind: Text, ref: Text, page: z.int().positive().optional() }).strict())
      .default([]),
    provenance: z.record(z.string(), z.unknown()).default({}),
    status: z.enum(CONTENT_STATUSES),
  })
  .strict();

const ParamName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/);

export const TemplateParamSchema = z.discriminatedUnion('type', [
  z
    .object({
      name: ParamName,
      type: z.literal('int'),
      min: z.int(),
      max: z.int(),
      step: z.int().positive().optional(),
    })
    .strict(),
  z
    .object({
      name: ParamName,
      type: z.literal('decimal'),
      min: z.number(),
      max: z.number(),
      step: z.number().positive(),
    })
    .strict(),
  z
    .object({
      name: ParamName,
      type: z.literal('choice'),
      values: z.array(z.union([z.number(), z.string()])).min(1),
    })
    .strict(),
  z
    .object({
      name: ParamName,
      type: z.literal('words'),
      list: z.array(z.record(z.string(), z.unknown())).min(1),
    })
    .strict(),
]);

export const ItemTemplateSchema = z
  .object({
    item: Code,
    params: z.array(TemplateParamSchema).min(1),
    constraints: z.array(z.string().min(1)).default([]),
    answerExpr: Text,
    render: z
      .object({
        stem: Text,
        ttsText: OptionalText,
        explanation: OptionalText,
        decimal: z.enum(['comma', 'point']).optional(),
      })
      .strict(),
    distractorExprs: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** JSON Schemas written to packages/contracts/library/ by `pnpm openapi`. */
export const LIBRARY_JSON_SCHEMAS = {
  'manifest.schema.json': PackageManifestSchema,
  'curriculum.schema.json': PackageCurriculumSchema,
  'edges.schema.json': PackageEdgesSchema,
  'mappings.schema.json': PackageMappingsSchema,
  'media.schema.json': PackageMediaSchema,
  'group.schema.json': PackageGroupSchema,
  'item.schema.json': PackageItemSchema,
  'template.schema.json': ItemTemplateSchema,
} as const;

// --- Reading a package ----------------------------------------------------------------------------

export const PACKAGE_FILES = {
  manifest: 'manifest.json',
  curriculum: 'curriculum.json',
  edges: 'edges.json',
  mappings: 'mappings.json',
  groups: 'groups.jsonl',
  items: 'items.jsonl',
  templates: 'templates.jsonl',
  media: 'media/media.jsonl',
} as const;

export type PackageFiles = Record<string, Uint8Array>;

export type ParsedPackage =
  | { ok: true; pkg: LibraryPackage; warnings: PackageIssue[]; sha256: string }
  | { ok: false; errors: PackageIssue[] };

const decoder = new TextDecoder('utf-8', { fatal: true });

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Drops a single shared top folder (zips usually wrap the package in one) and directory entries.
 * Rejects absolute paths and `..` segments.
 */
export function normalisePackagePaths(files: PackageFiles): PackageFiles {
  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  for (const name of names) {
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`unsafe path in package: ${name}`);
    }
  }
  let prefix = '';
  if (!names.includes(PACKAGE_FILES.manifest)) {
    const manifest = names.find((n) => n.endsWith(`/${PACKAGE_FILES.manifest}`));
    if (manifest) prefix = manifest.slice(0, -PACKAGE_FILES.manifest.length);
  }
  const out: PackageFiles = {};
  for (const name of names) {
    if (name.startsWith(prefix) && !/(^|\/)(\.DS_Store|__MACOSX)/.test(name)) {
      out[name.slice(prefix.length)] = files[name]!;
    }
  }
  return out;
}

function zodIssues(file: string, error: z.ZodError, line?: number): PackageIssue[] {
  return error.issues.map((issue) => ({
    code: 'SCHEMA',
    message: `${file}${line ? `:${line}` : ''} ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ref: file,
  }));
}

/** Counts and checksums for a package (written by `pnpm library:validate --write-manifest`). */
export async function packageInventory(files: PackageFiles) {
  const checksums: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) {
    if (name !== PACKAGE_FILES.manifest) checksums[name] = await sha256Hex(files[name]!);
  }
  return { checksums };
}

/** Whole-package digest: sha256 over the sorted (path, sha256) list, manifest included. */
async function packageDigest(files: PackageFiles): Promise<string> {
  const parts: string[] = [];
  for (const name of Object.keys(files).sort())
    parts.push(`${name}\t${await sha256Hex(files[name]!)}`);
  return sha256Hex(parts.join('\n'));
}

/**
 * Parses and schema-checks a package from its files (paths relative to the package root).
 * Checks manifest checksums; the domain rules (`validateLibraryPackage`) run on the result.
 */
export async function parseLibraryPackage(rawFiles: PackageFiles): Promise<ParsedPackage> {
  let files: PackageFiles;
  try {
    files = normalisePackagePaths(rawFiles);
  } catch (e) {
    return { ok: false, errors: [{ code: 'UNSAFE_PATH', message: (e as Error).message }] };
  }
  const errors: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];
  const text = (name: string): string | undefined => {
    const bytes = files[name];
    if (bytes === undefined) return undefined;
    try {
      return decoder.decode(bytes).replace(/^﻿/, '');
    } catch {
      errors.push({ code: 'ENCODING', message: `${name} is not valid UTF-8`, ref: name });
      return undefined;
    }
  };
  const json = (name: string): unknown => {
    const source = text(name);
    if (source === undefined) return undefined;
    try {
      return JSON.parse(source);
    } catch (e) {
      errors.push({ code: 'JSON', message: `${name}: ${(e as Error).message}`, ref: name });
      return undefined;
    }
  };
  function jsonl<T>(name: string, schema: z.ZodType<T>): T[] {
    const source = text(name);
    if (source === undefined) return [];
    const out: T[] = [];
    source.split('\n').forEach((line, i) => {
      if (line.trim() === '') return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (e) {
        errors.push({
          code: 'JSON',
          message: `${name}:${i + 1}: ${(e as Error).message}`,
          ref: name,
        });
        return;
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) out.push(parsed.data);
      else errors.push(...zodIssues(name, parsed.error, i + 1));
    });
    return out;
  }
  function single<T>(name: string, schema: z.ZodType<T>, fallback?: T): T | undefined {
    const value = json(name);
    if (value === undefined) {
      if (fallback === undefined && files[name] === undefined) {
        errors.push({ code: 'MISSING_FILE', message: `${name} is missing`, ref: name });
      }
      return fallback;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    errors.push(...zodIssues(name, parsed.error));
    return undefined;
  }

  const manifest = single(PACKAGE_FILES.manifest, PackageManifestSchema);
  if (manifest) {
    for (const [name, expected] of Object.entries(manifest.checksums)) {
      const bytes = files[name];
      if (bytes === undefined) {
        errors.push({
          code: 'MISSING_FILE',
          message: `${name} is listed in the manifest but missing`,
          ref: name,
        });
      } else if ((await sha256Hex(bytes)) !== expected) {
        errors.push({
          code: 'CHECKSUM',
          message: `${name}: sha256 does not match the manifest`,
          ref: name,
        });
      }
    }
    for (const name of Object.keys(files)) {
      if (name !== PACKAGE_FILES.manifest && !(name in manifest.checksums)) {
        errors.push({
          code: 'UNLISTED_FILE',
          message: `${name} is not listed in the manifest checksums`,
          ref: name,
        });
      }
    }
  }
  const curriculum = single(PACKAGE_FILES.curriculum, PackageCurriculumSchema);
  const edges = single(PACKAGE_FILES.edges, PackageEdgesSchema, []);
  const mappings = single(PACKAGE_FILES.mappings, PackageMappingsSchema, {
    series: [],
    mappings: [],
  });
  const groups = jsonl(PACKAGE_FILES.groups, PackageGroupSchema);
  const items = jsonl(PACKAGE_FILES.items, PackageItemSchema);
  const templates = jsonl(PACKAGE_FILES.templates, ItemTemplateSchema);
  const media = jsonl(PACKAGE_FILES.media, PackageMediaSchema);
  const svgFiles: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    if (/^media\/[^/]+\.svg$/.test(name)) {
      const source = text(name);
      if (source !== undefined) svgFiles[name.slice('media/'.length)] = source;
    }
  }

  if (errors.length > 0 || !manifest || !curriculum || !edges || !mappings) {
    return { ok: false, errors };
  }
  if (manifest.counts.items !== undefined && manifest.counts.items !== items.length) {
    warnings.push({
      code: 'COUNT_MISMATCH',
      message: `manifest counts.items is ${manifest.counts.items}, items.jsonl has ${items.length}`,
    });
  }
  return {
    ok: true,
    pkg: { manifest, curriculum, edges, mappings, groups, items, templates, media, svgFiles },
    warnings,
    sha256: await packageDigest(files),
  };
}
