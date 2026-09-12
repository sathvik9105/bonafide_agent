// Phase 0 smoke test: Scopus source list -> CSV, then look up by ISSN and by title.
// Run: node --env-file=.env scripts/smoke-scopus.ts
// If data/scopus-sources.csv is missing, converts it from data/scopus-sources.xlsx
// (Elsevier's download) using unzip + a minimal XML reader, so no xlsx dependency.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const XLSX = 'data/scopus-sources.xlsx';
const CSV = 'data/scopus-sources.csv';

// Only the columns providers/registries.ts reads. Keeps the committed CSV small.
const KEEP_COLUMNS = [
  /^sourcerecord id$/i,
  /^source title$/i,
  /^issn$/i,
  /^eissn$/i,
  /^active or inactive$/i,
  /^coverage$/i,
  /^titles discontinued/i,
  /^source type$/i,
  /^publisher$/i,
  /^publisher imprints grouped/i,
];

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const unzip = (entry: string) =>
  execFileSync('unzip', ['-p', XLSX, entry], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function sheetToCsv(sheetEntry: string, shared: string[], out: string) {
  const xml = unzip(sheetEntry);
  const table: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? '';
      else if (type === 'inlineStr') value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
      else value = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      cells[colIndex(ref)] = value.trim();
    }
    table.push(Array.from(cells, (v) => v ?? ''));
  }
  const header = table[0] ?? [];
  const keep = KEEP_COLUMNS.map((re) => {
    const i = header.findIndex((h) => re.test(h.trim()));
    if (i < 0) throw new Error(`${sheetEntry}: no column matching ${re}`);
    return i;
  });
  const lines = table.map((r) => keep.map((i) => csvCell(r[i] ?? '')).join(','));
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`[convert] ${sheetEntry} -> ${out}: ${lines.length} rows, ${keep.length} of ${header.length} columns`);
}

function convert() {
  const t0 = Date.now();
  const sst = unzip('xl/sharedStrings.xml');
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''),
  );
  console.log(`[convert] ${shared.length} shared strings`);
  sheetToCsv('xl/worksheets/sheet1.xml', shared, CSV); // "Scopus Sources <Mon. YYYY>"
  console.log(`[convert] done in ${Date.now() - t0}ms`);
}

// RFC4180-ish parser, enough for our own output.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

const normTitle = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/^\s*the\s+/, '').replace(/\s+/g, ' ').trim();
const normIssn = (s: string) => s.replace(/[^0-9xX]/g, '').toUpperCase().padStart(8, '0');

// Word-level Jaccard. Character bigrams were too loose: "Advanced Computing Research"
// scored 0.931 against the real, inactive "Advanced Computer Research".
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let overlap = 0;
  for (const w of A) if (B.has(w)) overlap++;
  return overlap / (A.size + B.size - overlap || 1);
}

function main() {
  if (!existsSync(CSV)) {
    if (!existsSync(XLSX)) throw new Error(`${XLSX} missing; download the Scopus source title list first`);
    convert();
  }
  const t0 = Date.now();
  const [header, ...rows] = parseCsv(readFileSync(CSV, 'utf8'));
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const col = {
    title: find(/^source title/i),
    issn: find(/^issn$|print.?issn/i),
    eissn: find(/e-?issn/i),
    status: find(/active or inactive/i),
    coverage: find(/coverage/i),
    publisher: find(/publisher/i),
    type: find(/source type/i),
  };
  console.log(`[load] ${rows.length} rows in ${Date.now() - t0}ms`);
  console.log(`[load] headers: ${header.map((h, i) => `${i}:${h}`).join(' | ')}`);
  console.log(`[load] columns used: ${JSON.stringify(col)}`);
  const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
  if (col.title < 0 || col.issn < 0) throw new Error(`required columns not found: ${missing.join(', ')}`);

  const show = (r: string[]) =>
    `"${r[col.title]}" issn=${r[col.issn]} eissn=${r[col.eissn] ?? ''} status=${r[col.status] ?? ''} ` +
    `coverage=${(r[col.coverage] ?? '').slice(0, 60)} publisher=${r[col.publisher] ?? ''}`;

  const byIssn = new Map<string, string[]>();
  for (const r of rows) {
    for (const i of [col.issn, col.eissn]) if (i >= 0 && r[i]) byIssn.set(normIssn(r[i]), r);
  }

  let pass = true;
  const issnCases: [string, boolean][] = [
    ['0162-8828', true], // IEEE TPAMI
    ['0028-0836', true], // Nature
    ['2345-6789', false], // fabricated, from the synthetic predatory invite
  ];
  for (const [issn, expect] of issnCases) {
    const hit = byIssn.get(normIssn(issn));
    const ok = !!hit === expect;
    pass &&= ok;
    console.log(`[issn] ${ok ? 'PASS' : 'FAIL'} ${issn} -> ${hit ? show(hit) : 'not found'}`);
  }

  const normed = rows.map((r) => normTitle(r[col.title] ?? ''));
  const titleCases: [string, boolean][] = [
    ['IEEE Transactions on Pattern Analysis and Machine Intelligence', true],
    ['The Lancet', true],
    ['International Journal of Advanced Computing Research', false],
  ];
  for (const [title, expect] of titleCases) {
    const q = normTitle(title);
    let best = -1;
    let score = 0;
    normed.forEach((t, i) => {
      const s = similarity(q, t);
      if (s > score) (score = s), (best = i);
    });
    const matched = score >= 0.92;
    const ok = matched === expect;
    pass &&= ok;
    console.log(
      `[title] ${ok ? 'PASS' : 'FAIL'} "${title}" -> best ${score.toFixed(3)} ${best >= 0 ? show(rows[best]) : ''} (match=${matched})`,
    );
  }
  console.log(`\nRESULT: scopus lookup ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
}
