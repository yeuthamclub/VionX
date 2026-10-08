// M01 identity & household schemas (TASK_PACKS/M01.md). Format checks live here; rules that need
// "now" or the database (birth-year range, lock state) live in @vionx/domain and the api.
import { z } from '@hono/zod-openapi';
import {
  ADMIN_PERMISSIONS,
  AVATARS,
  DISPLAY_NAME_MAX,
  HOUSEHOLD_NAME_MAX,
  HOUSEHOLD_ROLES,
  MAX_GRADE,
  MIN_GRADE,
  PIN_PATTERN,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Pin = z
  .string()
  .regex(PIN_PATTERN, 'PIN must be 4-8 digits')
  .openapi({ example: '582913', description: '4-8 digits' });
const LoginId = z.string().openapi({ example: 'vx-k7m2pq', description: '`vx-` + 6 characters' });

export const HouseholdRoleSchema = z.enum(HOUSEHOLD_ROLES).openapi('HouseholdRole');
export const AvatarSchema = z.enum(AVATARS).openapi('Avatar');
export const AdminPermissionSchema = z.enum(ADMIN_PERMISSIONS).openapi('AdminPermission');

// --- Parent account -------------------------------------------------------------------------
export const MeResponseSchema = z
  .object({
    userId: Uuid,
    phone: z.string().nullable(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    households: z.array(
      z.object({ id: Uuid, name: z.string(), role: HouseholdRoleSchema, timezone: z.string() }),
    ),
    adminPermissions: z.array(AdminPermissionSchema),
  })
  .openapi('Me');
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- Household --------------------------------------------------------------------------------
export const HouseholdCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(HOUSEHOLD_NAME_MAX).openapi({ example: 'Gia đình Minh' }),
    timezone: z.string().max(64).optional().openapi({ example: 'Asia/Ho_Chi_Minh' }),
  })
  .openapi('HouseholdCreateRequest');

export const HouseholdSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    timezone: z.string(),
    role: HouseholdRoleSchema,
    createdAt: DateTime,
  })
  .openapi('Household');

export const StudentStatusSchema = z
  .enum(['active', 'locked', 'disabled'])
  .openapi('StudentStatus');

export const StudentSchema = z
  .object({
    id: Uuid,
    displayName: z.string(),
    birthYear: z.int(),
    grade: z.int().min(MIN_GRADE).max(MAX_GRADE),
    avatar: AvatarSchema,
    childLoginId: LoginId,
    status: StudentStatusSchema,
    lockedUntil: DateTime.nullable(),
    failedAttempts: z.int().nonnegative(),
    activeSessions: z.int().nonnegative(),
    createdAt: DateTime,
    updatedAt: DateTime,
  })
  .openapi('Student');
export type Student = z.infer<typeof StudentSchema>;

export const HouseholdResponseSchema = z
  .object({ household: HouseholdSchema, students: z.array(StudentSchema) })
  .openapi('HouseholdResponse');
export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;

// --- Students -----------------------------------------------------------------------------------
const StudentFields = {
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX).openapi({ example: 'Minh' }),
  birthYear: z.int().openapi({ example: 2014 }),
  grade: z.int().min(MIN_GRADE).max(MAX_GRADE).openapi({ example: 6 }),
  avatar: AvatarSchema,
};

export const StudentCreateRequestSchema = z
  .object({
    ...StudentFields,
    avatar: AvatarSchema.optional(),
    pin: Pin.optional().openapi({ description: 'Omit to let the server generate a 6-digit PIN.' }),
  })
  .openapi('StudentCreateRequest');

export const StudentPatchRequestSchema = z
  .object({
    displayName: StudentFields.displayName.optional(),
    birthYear: StudentFields.birthYear.optional(),
    grade: StudentFields.grade.optional(),
    avatar: AvatarSchema.optional(),
  })
  .openapi('StudentPatchRequest');

export const ChildCredentialsSchema = z
  .object({
    childLoginId: LoginId,
    pin: Pin.openapi({ description: 'Shown once on the credential card; never stored in clear.' }),
  })
  .openapi('ChildCredentials');

export const StudentCreateResponseSchema = z
  .object({ student: StudentSchema, credentials: ChildCredentialsSchema })
  .openapi('StudentCreateResponse');

export const ResetPinRequestSchema = z
  .object({
    pin: Pin.optional().openapi({ description: 'Omit to generate a new 6-digit PIN.' }),
    revokeSessions: z
      .boolean()
      .optional()
      .openapi({ description: 'Also sign the child out everywhere.' }),
  })
  .openapi('ResetPinRequest');

export const ResetPinResponseSchema = z
  .object({ credentials: ChildCredentialsSchema, revokedSessions: z.int().nonnegative() })
  .openapi('ResetPinResponse');

export const RevokeSessionsResponseSchema = z
  .object({ revokedSessions: z.int().nonnegative() })
  .openapi('RevokeSessionsResponse');

export const DisableRequestSchema = z
  .object({
    disabled: z
      .boolean()
      .optional()
      .openapi({ description: 'Default true. false re-enables the child login.' }),
  })
  .openapi('DisableRequest');

export const StudentIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' } }),
});

// --- Child auth ----------------------------------------------------------------------------------
export const ChildLoginRequestSchema = z
  .object({
    childLoginId: z.string().min(1).max(32).openapi({ example: 'vx-k7m2pq' }),
    pin: z.string().min(1).max(16).openapi({ example: '582913' }),
    deviceId: z.string().min(1).max(128).openapi({ example: 'android-6f1c…' }),
  })
  .openapi('ChildLoginRequest');

export const ChildProfileSchema = z
  .object({
    id: Uuid,
    displayName: z.string(),
    grade: z.int(),
    avatar: AvatarSchema,
  })
  .openapi('ChildProfile');

export const ChildLoginResponseSchema = z
  .object({
    token: z.string().openapi({ description: 'Opaque; send as `x-vionx-child-session`.' }),
    expiresAt: DateTime,
    student: ChildProfileSchema,
  })
  .openapi('ChildLoginResponse');

export const ChildSessionResponseSchema = z
  .object({ expiresAt: DateTime, student: ChildProfileSchema })
  .openapi('ChildSession');

export const ChildLogoutResponseSchema = z
  .object({ revoked: z.boolean() })
  .openapi('ChildLogoutResponse');

export const CHILD_SESSION_HEADER = 'x-vionx-child-session';
