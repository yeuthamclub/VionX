// Splits markdown-ish text into plain text and TeX segments for the KaTeX preview.

export type Segment =
  { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

/**
 * `$$…$$` is display math, `$…$` inline math; `\$` is a literal dollar. An unclosed delimiter
 * stays text, so a half-typed formula never swallows the rest of the stem.
 */
export function splitMath(input: string): Segment[] {
  const segments: Segment[] = [];
  let text = '';
  let i = 0;
  const flush = () => {
    if (text) segments.push({ kind: 'text', text });
    text = '';
  };
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '\\' && input[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      const display = input[i + 1] === '$';
      const open = display ? 2 : 1;
      const close = findClose(input, i + open, display);
      if (close > i + open) {
        flush();
        segments.push({ kind: 'math', tex: input.slice(i + open, close).trim(), display });
        i = close + open;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return segments;
}

function findClose(input: string, from: number, display: boolean): number {
  for (let j = from; j < input.length; j += 1) {
    if (input[j] === '\\') {
      j += 1;
      continue;
    }
    if (input[j] !== '$') continue;
    if (!display) return input[j + 1] === '$' ? -1 : j;
    if (input[j + 1] === '$') return j;
  }
  return -1;
}
