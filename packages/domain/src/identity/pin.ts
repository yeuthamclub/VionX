import { err, ok, type Result } from '../shared/result.ts';
import { randomString, type RandomBytes } from './random.ts';

/** Child PIN: 4-8 digits (Master Spec §6.1). Stored only as an argon2id hash. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const PIN_PATTERN = /^\d{4,8}$/;
export const GENERATED_PIN_LENGTH = 6;

export type PinError = 'PIN_FORMAT';

export function validatePin(pin: string): Result<string, PinError> {
  return PIN_PATTERN.test(pin) ? ok(pin) : err('PIN_FORMAT', 'PIN must be 4-8 digits');
}

/** All digits equal (1111) or a straight run up or down (1234, 9876). */
export function isTrivialPin(pin: string): boolean {
  if (!PIN_PATTERN.test(pin)) return false;
  const d = [...pin].map(Number);
  const steps = new Set(d.slice(1).map((x, i) => x - d[i]!));
  return steps.size === 1 && [0, 1, -1].includes([...steps][0]!);
}

/** A random PIN for the one-time credential card; never trivial. */
export function generatePin(random: RandomBytes, length = GENERATED_PIN_LENGTH): string {
  if (length < PIN_MIN_LENGTH || length > PIN_MAX_LENGTH) throw new RangeError('PIN length 4..8');
  for (;;) {
    const pin = randomString('0123456789', length, random);
    if (!isTrivialPin(pin)) return pin;
  }
}
