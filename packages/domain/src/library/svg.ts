// SVG sanitiser for library media (TASK_PACKS/M05.md: no scripts, no external refs). Allowlist
// based: unknown elements are dropped with their subtree, unknown attributes are dropped, and only
// in-document references (`#id`) survive. Pure string processing so it runs in every runtime.
import { err, ok, type Result } from '../shared/result.ts';

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'use',
  'symbol',
  'clippath',
  'mask',
  'pattern',
  'marker',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'xmlns',
  'xmlns:xlink',
  'version',
  'id',
  'class',
  'viewbox',
  'preserveaspectratio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'dx',
  'dy',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'patternunits',
  'patterntransform',
  'clip-path',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerwidth',
  'markerheight',
  'refx',
  'refy',
  'orient',
  'href',
  'xlink:href',
  'role',
  'aria-label',
  'aria-hidden',
  'visibility',
  'display',
]);

/** Attributes whose value may contain `url(...)`; only `url(#id)` is kept. */
const URL_VALUE = /url\s*\(\s*(['"]?)\s*([^)'"]*)\1\s*\)/gi;

export interface SanitisedSvg {
  svg: string;
  /** What was removed, for the import report (empty when the input was already clean). */
  removed: string[];
}

const escapeAttr = (value: string) =>
  value
    .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');

function safeValue(name: string, value: string): boolean {
  if (/javascript:|data:|vbscript:/i.test(value.replace(/\s+/g, ''))) return false;
  if (name === 'href' || name === 'xlink:href') return /^#[\w.-]+$/.test(value.trim());
  for (const match of value.matchAll(URL_VALUE)) {
    if (!/^#[\w.-]+$/.test((match[2] ?? '').trim())) return false;
  }
  return true;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![\s\S]*?>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

/**
 * Returns a sanitised copy of `input`. Fails (rather than guessing) on DOCTYPE/ENTITY
 * declarations, a root that is not `<svg>`, or unbalanced tags.
 */
export function sanitizeSvg(input: string): Result<SanitisedSvg, 'INVALID_SVG'> {
  const removed: string[] = [];
  const out: string[] = [];
  const stack: { name: string; kept: boolean }[] = [];
  let skipDepth = 0;
  let sawRoot = false;

  for (const match of input.matchAll(TOKEN)) {
    const token = match[0];
    const [, closeName, openName, rawAttrs, selfClose] = match;

    if (token.startsWith('<!--')) continue;
    if (token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) {
      if (skipDepth === 0) removed.push('CDATA section');
      continue;
    }
    if (token.startsWith('<!'))
      return err('INVALID_SVG', 'DOCTYPE and ENTITY declarations are not allowed');
    if (token === '<') return err('INVALID_SVG', 'stray "<" in SVG');

    if (closeName !== undefined) {
      const name = closeName.toLowerCase();
      const top = stack.pop();
      if (!top || top.name !== name) return err('INVALID_SVG', `unbalanced </${closeName}>`);
      if (!top.kept) skipDepth--;
      else if (skipDepth === 0) out.push(`</${closeName}>`);
      continue;
    }

    if (openName !== undefined) {
      const name = openName.toLowerCase();
      if (!sawRoot) {
        if (name !== 'svg') return err('INVALID_SVG', 'the root element must be <svg>');
        sawRoot = true;
      } else if (stack.length === 0) {
        return err('INVALID_SVG', 'content after the root <svg> element');
      }
      const kept = skipDepth === 0 && ALLOWED_ELEMENTS.has(name);
      if (!kept && skipDepth === 0) removed.push(`<${openName}>`);
      if (kept) {
        const attrs: string[] = [];
        for (const a of (rawAttrs ?? '').matchAll(ATTRIBUTE)) {
          const attrName = a[1]!;
          const lower = attrName.toLowerCase();
          const value = a[2] ?? a[3] ?? a[4] ?? '';
          if (!ALLOWED_ATTRIBUTES.has(lower) || !safeValue(lower, value)) {
            removed.push(`${openName}@${attrName}`);
            continue;
          }
          attrs.push(` ${attrName}="${escapeAttr(value)}"`);
        }
        out.push(`<${openName}${attrs.join('')}${selfClose ? '/' : ''}>`);
      }
      if (!selfClose) {
        stack.push({ name, kept });
        if (!kept) skipDepth++;
      }
      continue;
    }

    // Text: only inside kept elements; whitespace between top-level tokens is dropped.
    if (skipDepth === 0 && stack.length > 0) out.push(token);
  }

  if (!sawRoot) return err('INVALID_SVG', 'no <svg> element found');
  if (stack.length > 0) return err('INVALID_SVG', `unclosed <${stack[stack.length - 1]!.name}>`);
  return ok({ svg: out.join(''), removed });
}
