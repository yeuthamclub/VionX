import type { CapView, LedgerEntry, SystemCaps } from '@vionx/contracts/client';
import { DEFAULT_REWARD_RULES, SYSTEM_CAPS } from '@vionx/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { AppError, describeError } from './api-error.ts';
import {
  capBar,
  formatVnd,
  formToRules,
  ledgerLine,
  levelFraction,
  rulesToForm,
} from './rewards.ts';

afterEach(() => setLocale('vi'));

const caps: SystemCaps = { ...SYSTEM_CAPS, weekendTierCaps: [20, 30, 40, 50] };
const cap = (over: Partial<CapView> = {}): CapView => ({
  day: '2026-10-14',
  weekend: false,
  tier: null,
  capCoins: 20,
  maxCapCoins: 20,
  rewardableXp: 1250,
  capXp: 2000,
  projectedCoins: 12,
  reached: false,
  ...over,
});
const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e1',
  createdAt: '2026-10-14T12:00:00Z',
  rewardDay: '2026-10-14',
  entryKind: 'GRANT',
  lifetimeXpDelta: null,
  rewardableXpDelta: null,
  coinDelta: null,
  sourceType: 'task_completion',
  sourceId: 's1',
  ruleId: 'TASK_APPROVED',
  cappedReason: null,
  reversalOf: null,
  label: null,
  ...over,
});

describe('reward display helpers', () => {
  it('formats the nominal VND value per locale', () => {
    expect(formatVnd(20_000)).toBe('20.000 ₫');
    setLocale('en');
    expect(formatVnd(1_250_000)).toBe('1,250,000 VND');
  });

  it('fills the cap bar and names the weekend tier', () => {
    expect(capBar(cap())).toMatchObject({ fraction: 0.625, tierLine: null });
    expect(capBar(cap()).caption).toBe('1250/2000 XP · cuối ngày được 12 Coin');
    const full = capBar(cap({ rewardableXp: 3500, projectedCoins: 20, reached: true }));
    expect(full.fraction).toBe(1);
    expect(full.caption).toContain('20 Coin');
    const sat = capBar(cap({ weekend: true, tier: 2, capCoins: 40, maxCapCoins: 50, capXp: 4000 }));
    expect(sat.tierLine).toBe('Cuối tuần: mức 2, tối đa 40 Coin (cao nhất 50)');
    expect(
      levelFraction({
        level: 2,
        levelStartXp: 100,
        nextLevelXp: 300,
        xpIntoLevel: 50,
        xpForNextLevel: 200,
      }),
    ).toBe(0.25);
  });

  it('describes ledger lines with signed amounts', () => {
    expect(ledgerLine(entry({ coinDelta: 20, entryKind: 'DAY_CONVERSION' }))).toEqual({
      title: 'Đổi XP ngày 2026-10-14',
      amount: '+20 Coin',
      detail: null,
    });
    expect(
      ledgerLine(entry({ coinDelta: -5, entryKind: 'REDEMPTION_HOLD', label: 'Kem' })).amount,
    ).toBe('−5 Coin');
    expect(
      ledgerLine(
        entry({
          lifetimeXpDelta: 500,
          rewardableXpDelta: 0,
          cappedReason: 'LATE',
          label: 'Bài Toán',
        }),
      ),
    ).toEqual({
      title: 'Bài Toán',
      amount: '+500 XP',
      detail: 'Duyệt muộn: chỉ cộng vào tổng XP',
    });
  });
});

describe('rules form', () => {
  it('round-trips the defaults', () => {
    const form = rulesToForm(DEFAULT_REWARD_RULES);
    expect(formToRules(form, caps)).toEqual({ rules: DEFAULT_REWARD_RULES, errors: {} });
  });

  it('refuses caps above the system caps, descending tiers and non-numbers', () => {
    const form = {
      ...rulesToForm(DEFAULT_REWARD_RULES),
      weekdayCapCoins: '25',
      tier2: '25',
      readingTasks: 'abc',
    };
    expect(formToRules(form, caps).errors).toEqual({ readingTasks: 'Nhập một số' });
    const numeric = { ...form, readingTasks: '2' };
    expect(formToRules(numeric, caps)).toEqual({
      rules: null,
      errors: {
        weekdayCapCoins: 'Không được cao hơn 20',
        tier2: 'Mức sau không được thấp hơn mức trước',
      },
    });
  });

  it('maps reward error reasons and rule violations', () => {
    const err = (details: unknown, code: 'CONFLICT' | 'VALIDATION_FAILED' = 'CONFLICT') =>
      new AppError('api', code === 'CONFLICT' ? 409 : 400, {
        code,
        message: 'x',
        requestId: 'r',
        details,
      });
    expect(describeError(err({ reason: 'INSUFFICIENT_COINS' }))).toBe(
      'Chưa đủ Coin để đổi phần thưởng này.',
    );
    expect(
      describeError(
        err(
          { violations: [{ field: 'weekdayCapCoins', error: 'ABOVE_SYSTEM_CAP', limit: 20 }] },
          'VALIDATION_FAILED',
        ),
      ),
    ).toBe('Không được cao hơn 20');
  });
});
