/**
 * Small, forgiving CSV parser for spreadsheet exports (TeamSnap, Excel, Google Sheets).
 * Handles a UTF-8 BOM, quoted fields with escaped quotes, delimiters and newlines inside quotes,
 * CRLF / LF / CR line endings, and comma, semicolon or tab delimiters (auto-detected).
 */
export type CsvTable = { headers: string[]; rows: string[][] };

const DELIMS = [',', ';', '\t'] as const;

/** Pick the delimiter that appears most often outside quotes on the first line. */
export function detectDelimiter(text: string): string {
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMS) {
    let n = 0;
    let quoted = false;
    for (const ch of text) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === '\n' || ch === '\r')) break;
      else if (!quoted && ch === d) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === d) endField();
    else if (ch === '\r') {
      endRow();
      if (text[i + 1] === '\n') i++;
    } else if (ch === '\n') endRow();
    else field += ch;
    i++;
  }
  if (field !== '' || row.length) endRow();
  // Drop blank lines (a row with a single empty cell, or all-empty cells).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Parse with the first non-empty row as headers; short rows are padded. */
export function parseTable(input: string): CsvTable {
  const all = parseCsv(input);
  const headers = (all[0] ?? []).map((h) => h.trim());
  const rows = all.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  return { headers, rows };
}
