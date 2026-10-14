// Text measures used by textlayer (page quality, extraction validation) and check (n-gram overlap,
// duplicates, reading level). Pure functions.

/** NFC, lower case, punctuation → space, collapsed whitespace. Digits and diacritics are kept. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/\$[^$]*\$/g, (m) => ` ${m.replace(/[\\{}$]/g, ' ')} `)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const words = (text: string): string[] => {
  const n = normaliseText(text);
  return n === '' ? [] : n.split(' ');
};

// Vietnamese letters (lower case); a syllable is one run of them.
const VI_LETTERS = 'a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const VI_SYLLABLE = new RegExp(`^[${VI_LETTERS}]+$`);
const VI_DIACRITIC = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/;

/** Share of alphabetic tokens that are well-formed Vietnamese syllables, and share with diacritics. */
export function vietnameseScore(text: string): { validRatio: number; diacriticRatio: number } {
  const tokens = words(text).filter((t) => /\p{L}/u.test(t) && !/\d/.test(t));
  if (tokens.length === 0) return { validRatio: 0, diacriticRatio: 0 };
  const valid = tokens.filter((t) => VI_SYLLABLE.test(t)).length;
  const marked = tokens.filter((t) => VI_DIACRITIC.test(t)).length;
  return { validRatio: valid / tokens.length, diacriticRatio: marked / tokens.length };
}

// TCVN3 (ABC) puts Vietnamese letters on Latin-1 code points such as ¸ ¹ µ ¶ · ¨ ­ ® ¬ ª;
// VNI writes a base letter followed by a tone code such as "aù", "eá", "oà".
const TCVN3_CHARS = /[\u00a1-\u00bf\u00b8\u00b5-\u00b7]/g;
const VNI_PAIRS = /[aeiouyAEIOUY][ùøûõïáàåäãéèêëìíîòóôöúüÏÖÙØÛÕ]/g;
const MATH_CHARS = /[=+−\-×·÷/^√π≤≥<>≠∈∉⊂∪∩∞°%()[\]{}|]/g;

export type PageQuality = 'good' | 'legacy-encoding' | 'scanned' | 'formula-heavy';

export interface PageSignals {
  text: string;
  /** The page paints at least one image. */
  hasImage: boolean;
}

/** Minimum text-layer characters for a page to count as having text. */
export const MIN_TEXT_CHARS = 40;

/**
 * Classifies a page from its text layer (BOOK_PIPELINE §4). Only `good` pages skip the model:
 * scanned pages (no or almost no text), legacy encodings (TCVN3/VNI), formula-heavy pages, and
 * text without Vietnamese diacritics (a lost encoding) go to the vision route.
 */
export function classifyPage({ text, hasImage }: PageSignals): PageQuality {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < MIN_TEXT_CHARS) return 'scanned';
  const legacy =
    (text.match(TCVN3_CHARS)?.length ?? 0) / compact.length > 0.02 ||
    (text.match(VNI_PAIRS)?.length ?? 0) / compact.length > 0.02;
  if (legacy) return 'legacy-encoding';
  const { validRatio, diacriticRatio } = vietnameseScore(text);
  if (validRatio < 0.7 || diacriticRatio < 0.15) return 'legacy-encoding';
  if ((text.match(MATH_CHARS)?.length ?? 0) / compact.length > 0.12) return 'formula-heavy';
  // A page that is mostly a picture with a caption keeps the vision route for the figure text.
  if (hasImage && compact.length < 2 * MIN_TEXT_CHARS) return 'scanned';
  return 'good';
}

/** Jaccard similarity of word sets (partial text layer vs model reading). */
export function wordJaccard(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (x.size === 0 && y.size === 0) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

// --- n-gram overlap with the source books ---------------------------------------------------------

export class NgramIndex {
  private readonly grams = new Set<string>();
  constructor(readonly n: number) {}

  add(text: string): void {
    const w = words(text);
    for (let i = 0; i + this.n <= w.length; i++) this.grams.add(w.slice(i, i + this.n).join(' '));
  }

  get size(): number {
    return this.grams.size;
  }

  /** Shared n-grams of `text` with the index, and the longest copied run in words. */
  overlap(text: string): { shared: number; total: number; share: number; longestRun: number } {
    const w = words(text);
    let shared = 0;
    let run = 0;
    let longestRun = 0;
    const total = Math.max(0, w.length - this.n + 1);
    for (let i = 0; i < total; i++) {
      if (this.grams.has(w.slice(i, i + this.n).join(' '))) {
        shared++;
        run = run === 0 ? this.n : run + 1;
        longestRun = Math.max(longestRun, run);
      } else run = 0;
    }
    return { shared, total, share: total === 0 ? 0 : shared / total, longestRun };
  }
}

// --- Reading level (passages) ---------------------------------------------------------------------

export function readingLevel(text: string): { words: number; maxSentenceWords: number } {
  const sentences = text
    .split(/[.!?…]+[\s"”»)]*|\n+/)
    .map((s) => words(s).length)
    .filter((n) => n > 0);
  return {
    words: words(text).length,
    maxSentenceWords: sentences.length ? Math.max(...sentences) : 0,
  };
}
