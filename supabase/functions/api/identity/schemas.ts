// Identity module schemas. Shared shapes live in @vionx/contracts so the typed client and the
// OpenAPI document come from one definition.
export {
  ChildLoginRequestSchema,
  ChildLoginResponseSchema,
  ChildLogoutResponseSchema,
  ChildSessionResponseSchema,
  DisableRequestSchema,
  ErrorBodySchema,
  HouseholdCreateRequestSchema,
  HouseholdResponseSchema,
  HouseholdSchema,
  MeResponseSchema,
  ResetPinRequestSchema,
  ResetPinResponseSchema,
  RevokeSessionsResponseSchema,
  StudentCreateRequestSchema,
  StudentCreateResponseSchema,
  StudentIdParamSchema,
  StudentPatchRequestSchema,
  StudentSchema,
  type Student,
} from '@vionx/contracts';
