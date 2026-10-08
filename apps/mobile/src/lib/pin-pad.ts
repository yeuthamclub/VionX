import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@vionx/domain';

export type PinPadKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'back' | 'clear';

/** Next PIN value after a key press on the child PIN keypad (digits only, max 8). */
export function pressPinKey(pin: string, key: PinPadKey): string {
  if (key === 'back') return pin.slice(0, -1);
  if (key === 'clear') return '';
  return pin.length >= PIN_MAX_LENGTH ? pin : pin + key;
}

export const canSubmitPin = (pin: string): boolean =>
  pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;

/** Keypad layout, row by row. */
export const PIN_PAD_ROWS: PinPadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'back'],
];
