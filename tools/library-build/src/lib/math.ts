// math.js for answer re-computation, sandboxed like the domain variant engine (no imports, no
// parsing or evaluation from inside an expression).
import { all, create } from 'mathjs';

const math = create(all!, { matrix: 'Array', number: 'number' });
const compile = math.compile.bind(math);
const disabled = (name: string) => () => {
  throw new Error(`Function ${name} is disabled`);
};
math.import(
  Object.fromEntries(
    [
      'import',
      'createUnit',
      'evaluate',
      'parse',
      'compile',
      'simplify',
      'derivative',
      'resolve',
      'reviver',
    ].map((n) => [n, disabled(n)]),
  ),
  { override: true },
);

/** Evaluates a math.js expression to a number or boolean; throws on anything else. */
export function evaluateExpr(expr: string): number | boolean {
  const value: unknown = compile(expr).evaluate({});
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toPrecision(12));
  if (typeof value === 'boolean') return value;
  throw new Error(`"${expr}" does not evaluate to a number or boolean`);
}

/**
 * Reads a number from option or answer text: `12`, `-3`, `2,5` (decimal comma), `1.000.000` or
 * `1 000 000` (thousands), `3/4`, `$\frac{3}{4}$`, `$2\frac{1}{3}$`, `25%`, `$-\dfrac{1}{2}$`.
 * Returns null when the text is not a plain number.
 */
export function parseNumberText(text: string): number | null {
  let t = text
    .replace(/\$/g, '')
    .replace(/\\[dt]?frac/g, '\\frac')
    .replace(/\\[,;: ]|~/g, ' ')
    .replace(/[−–]/g, '-')
    .trim();
  const percent = t.endsWith('%');
  if (percent) t = t.slice(0, -1).trim();
  let value: number | null = null;
  const mixed = /^(-?)\s*(\d+)?\s*\\frac\{\s*(-?\d+)\s*\}\{\s*(-?\d+)\s*\}$/.exec(t);
  const slash = /^(-?)\s*(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) {
    const [, sign, whole, num, den] = mixed;
    if (Number(den) === 0) return null;
    value = (whole ? Number(whole) : 0) + Number(num) / Number(den);
    if (sign === '-') value = -value;
  } else if (slash) {
    const [, sign, num, den] = slash;
    if (Number(den) === 0) return null;
    value = (sign === '-' ? -1 : 1) * (Number(num) / Number(den));
  } else {
    let n = t.replace(/\s+/g, '');
    if (/^-?\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '');
    n = n.replace(',', '.');
    if (/^[-+]?\d+(\.\d+)?$/.test(n)) value = Number(n);
  }
  if (value === null || !Number.isFinite(value)) return null;
  return percent ? value / 100 : value;
}

export const sameNumber = (a: number, b: number, tolerance = 0) =>
  Math.abs(a - b) <= Math.max(tolerance, 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
