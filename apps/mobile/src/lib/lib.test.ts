import { describe, expect, it } from 'vitest';
import { AppError, describeError, unwrap } from './api-error.ts';
import { formatVnPhone, toE164Vn } from './phone.ts';
import { canSubmitPin, pressPinKey } from './pin-pad.ts';

describe('toE164Vn', () => {
  it('accepts common Vietnamese spellings', () => {
    for (const input of [
      '0900000001',
      '900000001',
      '84900000001',
      '+84 900 000 001',
      '090-000-0001',
    ]) {
      expect(toE164Vn(input)).toBe('+84900000001');
    }
  });
  it('rejects non-mobile or malformed numbers', () => {
    for (const input of ['', '12345', '0200000001', '+1 415 555 0100', '09000000011']) {
      expect(toE164Vn(input)).toBeNull();
    }
  });
  it('formats for display', () => {
    expect(formatVnPhone('+84900000001')).toBe('0900 000 001');
  });
});

describe('PIN keypad', () => {
  it('appends digits up to 8, backspaces and clears', () => {
    let pin = '';
    for (const d of '123456789') pin = pressPinKey(pin, d as never);
    expect(pin).toBe('12345678');
    expect(pressPinKey(pin, 'back')).toBe('1234567');
    expect(pressPinKey(pin, 'clear')).toBe('');
  });
  it('allows submit at 4-8 digits', () => {
    expect(canSubmitPin('123')).toBe(false);
    expect(canSubmitPin('1234')).toBe(true);
    expect(canSubmitPin('12345678')).toBe(true);
  });
});

describe('API errors', () => {
  const apiError = (code: string, details?: unknown, status = 400) =>
    new AppError('api', status, { code: code as never, message: code, requestId: 'r', details });

  it('explains wrong PINs with the attempts left', () => {
    expect(describeError(apiError('INVALID_CREDENTIALS', { attemptsRemaining: 2 }))).toBe(
      'Sai mã PIN. Còn 2 lần thử.',
    );
    expect(describeError(apiError('INVALID_CREDENTIALS'))).toBe('Mã đăng nhập hoặc PIN chưa đúng.');
  });

  it('explains the lock in minutes', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    expect(
      describeError(apiError('ACCOUNT_LOCKED', { lockedUntil: '2026-10-08T10:14:10Z' }), now),
    ).toBe('Nhập sai quá nhiều lần. Thử lại sau 15 phút hoặc nhờ bố mẹ đặt lại PIN.');
  });

  it('distinguishes offline from server errors', () => {
    expect(describeError(new AppError('offline', 0))).toBe(
      'Không có kết nối. Kiểm tra mạng rồi thử lại.',
    );
    expect(describeError(new Error('boom'))).toBe('Có lỗi xảy ra. Vui lòng thử lại.');
  });

  it('unwrap returns data or throws AppError', async () => {
    const ok = Promise.resolve({ data: { a: 1 }, response: new Response(null, { status: 200 }) });
    expect(await unwrap(ok)).toEqual({ a: 1 });
    const notFound = Promise.resolve({
      error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' },
      response: new Response(null, { status: 404 }),
    });
    await expect(unwrap(notFound)).rejects.toMatchObject({
      kind: 'api',
      status: 404,
      code: 'NOT_FOUND',
    });
    await expect(
      unwrap(Promise.reject(new TypeError('Network request failed'))),
    ).rejects.toMatchObject({
      kind: 'offline',
    });
  });
});
