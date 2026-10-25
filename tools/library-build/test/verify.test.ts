import { describe, expect, it } from 'vitest';
import type { PackageItem } from '@vionx/domain';
import type { ItemRecord } from '../src/items.ts';
import type { CheckResult } from '../src/lib/checks.ts';
import { codeConfirmed } from '../src/steps/verify.ts';

const record = (
  item: Partial<PackageItem>,
  checks: CheckResult[] = [
    { check: 'recompute', ok: true },
    { check: 'template_seeds', ok: true },
  ],
): ItemRecord => ({
  slot: 'S.Q01',
  attempt: 1,
  item: { kind: 'STATIC', type: 'numeric', stemMd: '', provenance: {}, ...item } as PackageItem,
  checks,
});

describe('codeConfirmed', () => {
  it('trusts a TEMPLATE only when every seed passed (DIV.IRRED.Q03 had a correct key)', () => {
    expect(codeConfirmed(record({ kind: 'TEMPLATE' }))).toBe(true);
    expect(
      codeConfirmed(record({ kind: 'TEMPLATE' }, [{ check: 'template_seeds', ok: false }])),
    ).toBe(false);
  });

  it('trusts an expression over the numbers printed in the stem', () => {
    const stem = 'Rút gọn $\\frac{45}{72}$ rồi tính tổng tử và mẫu.';
    expect(
      codeConfirmed(
        record({ stemMd: stem, provenance: { answerCheckExpr: '45/gcd(45,72) + 72/gcd(45,72)' } }),
      ),
    ).toBe(true);
    expect(
      codeConfirmed(
        record({
          stemMd: 'Bạn tiêu 80 000 trong 200 000 đồng.',
          provenance: { answerCheckExpr: '80000/200000' },
        }),
      ),
    ).toBe(true);
  });

  it('does not trust constants, formula numbers missing from the stem, or a failed recompute', () => {
    const stem = 'Rút gọn $\\frac{45}{72}$ rồi tính tổng tử và mẫu.';
    expect(codeConfirmed(record({ stemMd: stem, provenance: { answerCheckExpr: '19' } }))).toBe(
      false,
    );
    expect(
      codeConfirmed(
        record({
          stemMd: 'Hình chữ nhật dài 5, rộng 3.',
          provenance: { answerCheckExpr: '2*(5+3)' },
        }),
      ),
    ).toBe(false);
    expect(
      codeConfirmed(
        record({ stemMd: stem, provenance: { answerCheckExpr: '5+8' } }, [
          { check: 'recompute', ok: false },
        ]),
      ),
    ).toBe(false);
    expect(codeConfirmed(record({ stemMd: stem }))).toBe(false);
  });
});
