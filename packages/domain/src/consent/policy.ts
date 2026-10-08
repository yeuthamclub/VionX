export interface PolicyVersionInfo {
  version: number;
  effectiveAt: Date;
  requiresReconsent: boolean;
}

/** The version in force at `now`: the highest version already effective (null if none yet). */
export function currentPolicyVersion(
  versions: readonly PolicyVersionInfo[],
  now: Date,
): number | null {
  let current: number | null = null;
  for (const v of versions) {
    if (v.effectiveAt.getTime() <= now.getTime() && (current === null || v.version > current)) {
      current = v.version;
    }
  }
  return current;
}

/**
 * Lowest version whose consents are still valid: the newest effective version that requires
 * re-consent, otherwise the first version. Mirrors SQL `app.policy_min_accepted_version`.
 */
export function minimumAcceptedVersion(versions: readonly PolicyVersionInfo[], now: Date): number {
  let reconsent: number | null = null;
  let first: number | null = null;
  for (const v of versions) {
    if (first === null || v.version < first) first = v.version;
    if (
      v.requiresReconsent &&
      v.effectiveAt.getTime() <= now.getTime() &&
      (reconsent === null || v.version > reconsent)
    ) {
      reconsent = v.version;
    }
  }
  return reconsent ?? first ?? 1;
}

/** A parent must (re-)accept a policy when they never accepted a still-valid version. */
export function needsPolicyAcceptance(
  acceptedVersions: readonly number[],
  versions: readonly PolicyVersionInfo[],
  now: Date,
): boolean {
  if (currentPolicyVersion(versions, now) === null) return false;
  const minimum = minimumAcceptedVersion(versions, now);
  return !acceptedVersions.some((v) => v >= minimum);
}
