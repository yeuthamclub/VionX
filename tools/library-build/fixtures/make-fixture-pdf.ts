// Writes the synthetic source PDF used by the tests and the fake end-to-end run:
// page 1 has a text layer (a "Mục lục" page in Vietnamese), page 2 is image-only (a scan).
// The real SGK/SGV PDFs are image-only scans on the owner's drive; they are never committed.
//   pnpm --filter @vionx/library-build exec tsx fixtures/make-fixture-pdf.ts [font.ttf]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';

const fontPath = process.argv[2] ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const out = resolve(import.meta.dirname, 'MATH.6/source/SGK-Toan6-tap1-fixture.pdf');

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
doc.setTitle('VionX synthetic fixture (not a textbook)');
doc.setCreationDate(new Date('2026-10-14T00:00:00Z'));
doc.setModificationDate(new Date('2026-10-14T00:00:00Z'));
const font = await doc.embedFont(readFileSync(fontPath), { subset: true });

const toc = doc.addPage([420, 595]);
const lines = [
  'MỤC LỤC',
  'Chương IV. Một số hình phẳng trong thực tiễn',
  'Bài 18. Hình tam giác đều. Hình vuông. Hình lục giác đều ........ 2',
  'Bài 19. Hình chữ nhật. Hình thoi. Hình bình hành ........ 2',
  'Bài 20. Chu vi và diện tích của một số tứ giác đã học ........ 2',
  'Chương V. Tính đối xứng của hình phẳng',
  'Bài 21. Hình có trục đối xứng ........ 2',
  'Bài 22. Hình có tâm đối xứng ........ 2',
];
lines.forEach((line, i) =>
  toc.drawText(line, {
    x: 36,
    y: 540 - i * 26,
    size: i === 0 ? 16 : 11,
    font,
    color: rgb(0, 0, 0),
  }),
);

// Page 2: a picture of a page, no text operators (what the scanned SGK looks like to pdf.js).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="595" viewBox="0 0 420 595">
  <rect width="420" height="595" fill="#ffffff"/>
  <rect x="36" y="40" width="348" height="18" fill="#333"/>
  ${Array.from({ length: 14 }, (_, i) => `<rect x="36" y="${90 + i * 22}" width="${300 - (i % 4) * 40}" height="8" fill="#888"/>`).join('')}
  <rect x="120" y="420" width="180" height="110" fill="none" stroke="#333" stroke-width="3"/>
</svg>`;
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 420 } }).render().asPng();
const scan = doc.addPage([420, 595]);
scan.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 420, height: 595 });

writeFileSync(out, await doc.save({ useObjectStreams: false }));
console.log(`wrote ${out}`);
