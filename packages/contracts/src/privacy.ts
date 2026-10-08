// M02 consent & privacy schemas (TASK_PACKS/M02.md). Rules live in @vionx/domain.
import { z } from '@hono/zod-openapi';
import {
  CHILD_ASSENT_DECISIONS,
  CHILD_ASSENT_STATUSES,
  CONSENT_RECORD_STATUSES,
  CONSENT_TYPES,
  DELETION_JOB_STATUSES,
  EXPORT_JOB_STATUSES,
  POLICY_LOCALES,
  POLICY_TYPES,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const DeviceId = z
  .string()
  .min(1)
  .max(128)
  .openapi({ example: 'android-6f1c…', description: 'Stored only as a sha-256 hash.' });

export const ConsentTypeSchema = z.enum(CONSENT_TYPES).openapi('ConsentType');
export const PolicyTypeSchema = z.enum(POLICY_TYPES).openapi('PolicyType');
export const PolicyLocaleSchema = z.enum(POLICY_LOCALES).openapi('PolicyLocale');
export const ChildAssentStatusSchema = z.enum(CHILD_ASSENT_STATUSES).openapi('ChildAssentStatus');
export const ConsentDeniedReasonSchema = z
  .enum([
    'NOT_GRANTED',
    'REVOKED',
    'RECONSENT_REQUIRED',
    'CHILD_ASSENT_PENDING',
    'CHILD_ASSENT_DECLINED',
  ])
  .openapi('ConsentDeniedReason');

// --- Policies -------------------------------------------------------------------------------------
export const PolicySchema = z
  .object({
    type: PolicyTypeSchema,
    version: z.int().positive(),
    locale: PolicyLocaleSchema,
    title: z.string(),
    effectiveAt: DateTime,
    requiresReconsent: z.boolean(),
    contentMd: z.string().openapi({ description: 'Markdown. Version 1 is a DRAFT.' }),
  })
  .openapi('Policy');

export const PolicyAcceptanceSchema = z
  .object({
    type: PolicyTypeSchema,
    version: z.int().positive(),
    locale: PolicyLocaleSchema,
    acceptedAt: DateTime,
  })
  .openapi('PolicyAcceptance');

export const PoliciesQuerySchema = z.object({
  locale: PolicyLocaleSchema.optional().openapi({
    param: { name: 'locale', in: 'query' },
    example: 'vi',
  }),
});

export const PoliciesResponseSchema = z
  .object({
    locale: PolicyLocaleSchema,
    policies: z.array(PolicySchema),
    minimumAcceptedVersions: z.object({
      PRIVACY_POLICY: z.int().positive(),
      TERMS_OF_SERVICE: z.int().positive(),
    }),
    acceptances: z
      .array(PolicyAcceptanceSchema)
      .nullable()
      .openapi({ description: 'The signed-in parent’s acceptances; null without a parent token.' }),
    needsAcceptance: z
      .boolean()
      .nullable()
      .openapi({ description: 'True when the parent must accept the current versions.' }),
  })
  .openapi('PoliciesResponse');
export type PoliciesResponse = z.infer<typeof PoliciesResponseSchema>;

export const PolicyAcceptRequestSchema = z
  .object({
    policies: z
      .array(z.object({ type: PolicyTypeSchema, version: z.int().positive() }))
      .min(1)
      .max(POLICY_TYPES.length),
    locale: PolicyLocaleSchema.optional(),
    deviceId: DeviceId.optional(),
  })
  .openapi('PolicyAcceptRequest');

export const PolicyAcceptResponseSchema = z
  .object({ acceptances: z.array(PolicyAcceptanceSchema) })
  .openapi('PolicyAcceptResponse');

// --- Consents -------------------------------------------------------------------------------------
export const ConsentRecordSchema = z
  .object({
    id: Uuid,
    consentType: ConsentTypeSchema,
    policyVersion: z.int().positive(),
    status: z.enum(CONSENT_RECORD_STATUSES),
    grantedAt: DateTime,
    grantedByParentId: Uuid.nullable(),
    revokedAt: DateTime.nullable(),
    revokedByType: z.enum(['parent', 'system']).nullable(),
    childAssentRequired: z.boolean(),
    childAssentStatus: ChildAssentStatusSchema,
    childAssentAt: DateTime.nullable(),
  })
  .openapi('ConsentRecord');
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const ConsentStateSchema = z
  .object({
    type: ConsentTypeSchema,
    effective: z.boolean(),
    reason: z.union([ConsentDeniedReasonSchema, z.null()]),
    // The latest record of this type (any status), or null.
    record: z.union([ConsentRecordSchema, z.null()]),
    childAssentRequiredNow: z
      .boolean()
      .openapi({ description: 'A grant made now would need the child’s assent (age ≥ 7).' }),
  })
  .openapi('ConsentState');
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const StudentConsentsResponseSchema = z
  .object({
    studentId: Uuid,
    policy: z.object({
      type: z.literal('PRIVACY_POLICY'),
      currentVersion: z.int().positive(),
      minimumAcceptedVersion: z.int().positive(),
    }),
    consents: z.array(ConsentStateSchema),
    history: z.array(ConsentRecordSchema).openapi({ description: 'All records, newest first.' }),
  })
  .openapi('StudentConsents');
export type StudentConsentsResponse = z.infer<typeof StudentConsentsResponseSchema>;

export const ConsentParamsSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' } }),
  type: ConsentTypeSchema.openapi({ param: { name: 'type', in: 'path' } }),
});

export const ConsentTypeParamSchema = z.object({
  type: ConsentTypeSchema.openapi({ param: { name: 'type', in: 'path' } }),
});

export const ConsentGrantRequestSchema = z
  .object({
    policyVersion: z.int().positive().openapi({
      description: 'The PRIVACY_POLICY version the parent was shown; must be the current one.',
    }),
    deviceId: DeviceId.optional(),
  })
  .openapi('ConsentGrantRequest');

export const ConsentRevokeRequestSchema = z
  .object({ deviceId: DeviceId.optional() })
  .openapi('ConsentRevokeRequest');

export const ChildAssentRequestSchema = z
  .object({ decision: z.enum(CHILD_ASSENT_DECISIONS) })
  .openapi('ChildAssentRequest');

export const ChildConsentCheckResponseSchema = z
  .object({ type: ConsentTypeSchema, effective: z.literal(true) })
  .openapi('ChildConsentCheck');

// --- Export & deletion ----------------------------------------------------------------------------
export const ExportJobSchema = z
  .object({
    id: Uuid,
    status: z.enum(EXPORT_JOB_STATUSES),
    requestedAt: DateTime,
    startedAt: DateTime.nullable(),
    completedAt: DateTime.nullable(),
    expiresAt: DateTime.nullable(),
    sizeBytes: z.int().nonnegative().nullable(),
    downloadUrl: z.string().nullable().openapi({
      description: 'Signed URL to the zip, valid until expiresAt (24 h after completion).',
    }),
  })
  .openapi('ExportJob');
export type ExportJob = z.infer<typeof ExportJobSchema>;

export const ExportJobResponseSchema = z
  .object({ job: ExportJobSchema })
  .openapi('ExportJobResponse');

export const ExportJobParamSchema = z.object({
  jobId: Uuid.openapi({ param: { name: 'jobId', in: 'path' } }),
});

export const DeleteRequestSchema = z
  .object({
    confirm: z.literal(true).openapi({ description: 'Must be true.' }),
    source: z.enum(['app', 'web']).optional(),
  })
  .openapi('DeleteRequest');

export const DeletionJobSchema = z
  .object({
    id: Uuid,
    scope: z.enum(['CHILD', 'ACCOUNT']),
    studentId: Uuid.nullable(),
    status: z.enum(DELETION_JOB_STATUSES),
    requestedAt: DateTime,
    purgeAfter: DateTime,
    completedAt: DateTime.nullable(),
  })
  .openapi('DeletionJob');
export type DeletionJob = z.infer<typeof DeletionJobSchema>;

export const DeletionResponseSchema = z
  .object({ deletion: DeletionJobSchema })
  .openapi('DeletionResponse');

export const PrivacyRequestSchema = z
  .object({
    id: Uuid,
    type: z.enum(PRIVACY_REQUEST_TYPES),
    status: z.enum(PRIVACY_REQUEST_STATUSES),
    studentId: Uuid.nullable(),
    source: z.enum(['app', 'web']),
    createdAt: DateTime,
    completedAt: DateTime.nullable(),
  })
  .openapi('PrivacyRequest');

export const PrivacyOverviewResponseSchema = z
  .object({
    acceptances: z.array(PolicyAcceptanceSchema),
    exports: z
      .array(ExportJobSchema)
      .openapi({ description: 'Latest 5 exports (downloadUrl is null here).' }),
    deletions: z.array(DeletionJobSchema),
    requests: z.array(PrivacyRequestSchema),
  })
  .openapi('PrivacyOverview');
export type PrivacyOverviewResponse = z.infer<typeof PrivacyOverviewResponseSchema>;
