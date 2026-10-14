// KaTeX parse check (BOOK_PIPELINE §4 and §6): every `$...$` / `$$...$$` span and every display
// formula must render with throwOnError.
import katex from 'katex';

/** Math spans of a Markdown string: `$$...$$` first, then `$...$`. */
export function mathSpans(text: string): string[] {
  const spans: string[] = [];
  const rest = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
    spans.push(tex);
    return ' ';
  });
  for (const m of rest.matchAll(/\$([^$\n]+?)\$/g)) spans.push(m[1]!);
  return spans;
}

/** Returns an error message for the first span that does not parse, or null. */
export function katexProblem(texts: (string | undefined | null)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    if ((text.replace(/\\\$/g, '').match(/\$/g)?.length ?? 0) % 2 !== 0) {
      return `unbalanced $ in "${text.slice(0, 60)}"`;
    }
    for (const tex of mathSpans(text)) {
      const error = katexError(tex);
      if (error) return error;
    }
  }
  return null;
}

export function katexError(tex: string): string | null {
  try {
    katex.renderToString(tex, { throwOnError: true, trust: false, strict: 'ignore' });
    return null;
  } catch (e) {
    return `KaTeX: ${(e as Error).message.split('\n')[0]} in "${tex.slice(0, 60)}"`;
  }
}
