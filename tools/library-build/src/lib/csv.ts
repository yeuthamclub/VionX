// RFC 4180 CSV for plan.csv and review.csv (Google Sheets / Excel). UTF-8 with a BOM so Excel
// reads Vietnamese correctly; Sheets ignores it.

const BOM = '﻿';

const quote = (value: string) =>
  /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;

export function toCsv(header: string[], rows: Record<string, string>[]): string {
  const lines = [header, ...rows.map((row) => header.map((h) => row[h] ?? ''))];
  return BOM + lines.map((cells) => cells.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** Parses CSV into rows of cells. Quoted cells may hold commas, quotes and line breaks. */
export function parseCsvRows(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV ends inside a quoted cell');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Parses CSV with a header row into records keyed by header name. */
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const [header, ...body] = parseCsvRows(text);
  if (!header) return { header: [], rows: [] };
  const names = header.map((h) => h.trim());
  return {
    header: names,
    rows: body.map((cells) => Object.fromEntries(names.map((h, i) => [h, cells[i] ?? '']))),
  };
}
