// PDF access for `textlayer`: the text layer and image use per page (pdf.js), and page subsets as
// new PDFs for the vision route (pdf-lib).
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const STANDARD_FONTS = `${resolve(import.meta.dirname, '../../node_modules/pdfjs-dist/standard_fonts')}/`;
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
]);

export interface PdfPageText {
  page: number;
  text: string;
  hasImage: boolean;
}

/** Text layer of every page (1-based page numbers), lines joined with newlines. */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfPageText[]> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages: PdfPageText[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      const ops = await page.getOperatorList();
      pages.push({
        page: n,
        text: text.normalize('NFC').trim(),
        hasImage: ops.fnArray.some((op) => IMAGE_OPS.has(op)),
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

/** A new PDF holding `pages` (1-based) of `bytes`, in that order. */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    pages.map((p) => p - 1),
  );
  for (const page of copied) out.addPage(page);
  return out.save();
}
