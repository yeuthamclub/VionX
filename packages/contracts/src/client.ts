import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './generated/openapi.ts';

export type { paths as ApiPaths } from './generated/openapi.ts';
/** Days a deletion request can be cancelled before the purge (admin deletion page copy). */
export { DELETION_GRACE_DAYS } from '@vionx/domain';
export type HealthResponse = components['schemas']['HealthResponse'];
export type ApiErrorBody = components['schemas']['Error'];
export type MeResponse = components['schemas']['Me'];
export type Household = components['schemas']['Household'];
export type HouseholdResponse = components['schemas']['HouseholdResponse'];
export type Student = components['schemas']['Student'];
export type ChildCredentials = components['schemas']['ChildCredentials'];
export type ChildLoginResponse = components['schemas']['ChildLoginResponse'];
export type ChildProfile = components['schemas']['ChildProfile'];
export type ChildSession = components['schemas']['ChildSession'];
export type Avatar = components['schemas']['Avatar'];
export type ConsentType = components['schemas']['ConsentType'];
export type ConsentState = components['schemas']['ConsentState'];
export type ConsentRecord = components['schemas']['ConsentRecord'];
export type StudentConsents = components['schemas']['StudentConsents'];
export type Policy = components['schemas']['Policy'];
export type PolicyType = components['schemas']['PolicyType'];
export type PoliciesResponse = components['schemas']['PoliciesResponse'];
export type ExportJob = components['schemas']['ExportJob'];
export type DeletionJob = components['schemas']['DeletionJob'];
export type PrivacyOverview = components['schemas']['PrivacyOverview'];
export type SchoolSubject = components['schemas']['SchoolSubject'];
export type TaskTemplate = components['schemas']['TaskTemplate'];
export type TimetableEntry = components['schemas']['TimetableEntry'];
export type TimetableSlot = components['schemas']['TimetableSlot'];
export type CalendarEvent = components['schemas']['CalendarEvent'];
export type CalendarEventType = components['schemas']['CalendarEventType'];
export type CalendarResponse = components['schemas']['CalendarResponse'];
export type Task = components['schemas']['Task'];
export type TaskType = components['schemas']['TaskType'];
export type TaskPriority = components['schemas']['TaskPriority'];
export type TaskOccurrence = components['schemas']['TaskOccurrence'];
export type TaskCompletion = components['schemas']['TaskCompletion'];
export type VerificationMode = components['schemas']['VerificationMode'];
export type ApprovalItem = components['schemas']['ApprovalItem'];
export type ApprovalsResponse = components['schemas']['ApprovalsResponse'];
export type Wallet = components['schemas']['Wallet'];
export type CapView = components['schemas']['CapView'];
export type LevelInfo = components['schemas']['LevelInfo'];
export type LedgerEntry = components['schemas']['LedgerEntry'];
export type LedgerResponse = components['schemas']['LedgerResponse'];
export type RewardRulesConfig = components['schemas']['RewardRulesConfig'];
export type RewardRulesResponse = components['schemas']['RewardRulesResponse'];
export type SystemCaps = components['schemas']['SystemCaps'];
export type CatalogItem = components['schemas']['CatalogItem'];
export type CatalogIcon = components['schemas']['CatalogIcon'];
export type CatalogResponse = components['schemas']['CatalogResponse'];
export type Redemption = components['schemas']['Redemption'];
export type RedemptionStatus = components['schemas']['RedemptionStatus'];
export type RedemptionsResponse = components['schemas']['RedemptionsResponse'];
export const CHILD_SESSION_HEADER = 'x-vionx-child-session';

export interface ApiClientOptions {
  /** e.g. `http://10.0.2.2:54321/functions/v1` (Android emulator → local Supabase). */
  baseUrl: string;
  /** Returns auth headers per request (parent JWT or child session token from M01). */
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof fetch;
}

/** Typed client for the `api` Edge Function, generated from docs/api/openapi.json. */
export function createApiClient(options: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (options.getHeaders) {
    const getHeaders = options.getHeaders;
    const auth: Middleware = {
      async onRequest({ request }) {
        for (const [key, value] of Object.entries(await getHeaders())) {
          request.headers.set(key, value);
        }
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
