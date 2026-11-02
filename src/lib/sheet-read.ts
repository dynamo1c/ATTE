/**
 * Reads the first sheet of an uploaded .xlsx or .csv file into rows of text (docs/PLAN.md §13 phase 10).
 * No dependency, like the writer in xlsx.ts: an .xlsx file is a zip of XML files.
 *
 * Every cell comes back as trimmed text with its row number as the person sees it in Excel, so import
 * errors can say "row 14". Numbers are written out in full (9845012345, never 9.845012345E9); dates
 * stay Excel serial numbers and are converted by the column that expects a date.
 */
import { inflateRawSync } from "node:zlib";

export interface ReadRow {
  /** Row number in the file (Excel row / CSV line of the record's start), 1-based. */
  line: number;
  cells: string[];
}

export type ReadResult = { ok: true; rows: ReadRow[]; format: "xlsx" | "csv" } | { ok: false; error: string };

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;
const MAX_COLUMNS = 100;
/** Unzipped size limit: protects the server from "zip bombs". */
const MAX_UNZIPPED = 60 * 1024 * 1024;

export function readTable(bytes: Uint8Array, fileName: string): ReadResult {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Old .xls files and password-protected .xlsx files are both "compound documents".
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    return { ok: false, error: "This is an old .xls file or a password-protected workbook. In Excel use File → Save As → “Excel Workbook (.xlsx)” without a password." };
  }
  try {
    const result = buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? { rows: readXlsx(buf), format: "xlsx" as const } : { rows: readCsv(buf), format: "csv" as const };
    if (result.format === "csv" && /\.(xlsx|xlsm|xls|ods|numbers)$/i.test(fileName)) {
      return { ok: false, error: "This file is not a valid Excel workbook. Open it in Excel and save it again as .xlsx." };
    }
    if (result.rows.length > MAX_ROWS) return { ok: false, error: `The file has more than ${MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.` };
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof ReadError ? e.message : "The file could not be read. Save it again as .xlsx or .csv (UTF-8) and retry." };
  }
}

class ReadError extends Error {}

/** Cell text: non-breaking spaces become spaces, line breaks and runs of spaces become one space. */
export function cleanCell(s: string): string {
  return s.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
}

function finish(rows: ReadRow[]): ReadRow[] {
  const out: ReadRow[] = [];
  for (const r of rows) {
    const cells = r.cells.slice(0, MAX_COLUMNS).map((c) => cleanCell(c ?? ""));
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.length) out.push({ line: r.line, cells });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

export function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: last 22 bytes, or earlier if the zip has a comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ReadError("This file is not a valid Excel workbook. Open it in Excel and save it again as .xlsx.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ReadError("The workbook is damaged. Open it in Excel and save it again.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const unzipped = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new ReadError("The workbook is password-protected. Remove the password and save it again.");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ReadError("The workbook is damaged. Open it in Excel and save it again.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (data.length !== size) throw new ReadError("The workbook is incomplete (was the upload cut off?). Try again.");
    // Only the XML parts are needed; skip pictures and other large parts without unpacking them.
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    total += unzipped;
    if (unzipped > MAX_UNZIPPED || total > MAX_UNZIPPED) throw new ReadError("The workbook is too large once opened. Keep only the data sheet and retry.");
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }));
    else throw new ReadError("The workbook uses an unusual compression. Open it in Excel and save it again as .xlsx.");
  }
  return files;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** XML text → plain text: entities and Excel's _xHHHH_ escapes. */
export function xmlDecode(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e];
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Attribute value; `id` also finds `r:id`. */
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(attrs)?.[1];

/** Text of <t> elements, ignoring phonetic guides (<rPh>). */
function textRuns(xml: string): string {
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of noPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += xmlDecode(m[1] ?? "");
  return out;
}

/** "9845012345", "1.5", "9.845012345E9" → full decimal text. */
export function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return n.toFixed(0);
  // Remove floating noise like 0.30000000000000004 the way Excel shows it.
  return String(Number(n.toPrecision(15)));
}

/** "AB12" → 27 (0-based column). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf: Buffer): ReadRow[] {
  // Some writers prefix every tag with a namespace (<x:c>); drop the prefixes.
  const files = unzip(buf);
  const xml = (name: string) => files.get(name)?.toString("utf8").replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1");
  const workbook = xml("xl/workbook.xml");
  if (!workbook) throw new ReadError("This file is not an Excel workbook. Save it as .xlsx and retry.");

  const shared: string[] = [];
  const sst = xml("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(textRuns(m[1] ?? ""));

  // Sheet tabs in order, following the workbook relationships (sheet files are not always sheet1.xml).
  // The first tab that has anything in it is the data (an empty "Sheet1" left in front is common).
  const rels = new Map<string, string>();
  for (const m of (xml("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)) rels.set(attr(m[1], "Id") ?? "", attr(m[1], "Target") ?? "");
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const target = rels.get(attr(m[1], "id") ?? "");
    if (!target) continue;
    const sheet = xml(target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    const rows = sheet ? sheetRows(sheet, shared) : [];
    if (rows.length) return rows;
  }
  return [];
}

function sheetRows(sheet: string, shared: readonly string[]): ReadRow[] {
  const rows: ReadRow[] = [];
  let nextLine = 1;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const line = Number(attr(rm[1], "r")) || nextLine;
    nextLine = line + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLUMNS) continue;
      const type = attr(cm[1], "t") ?? "n";
      const body = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = textRuns(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (type === "e") text = "";
      else if (type === "d") text = xmlDecode(v ?? "").slice(0, 10);
      else if (type === "str") text = xmlDecode(v ?? "");
      else text = v === undefined ? "" : numberText(xmlDecode(v));
      cells[col] = text;
    }
    for (let i = 0; i < cells.length; i++) cells[i] ??= "";
    rows.push({ line, cells });
    if (rows.length > MAX_ROWS + 1) break;
  }
  return finish(rows);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** UTF-8 (with or without BOM); files Excel saved as plain "CSV" in Windows-1252 also work. */
function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** Comma, semicolon or tab: whichever appears most in the first line (outside quotes). */
function guessDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r?\n|$/)).replace(/"[^"]*"/g, "");
  const counts = [",", ";", "\t"].map((d) => [d, first.split(d).length - 1] as const);
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

export function readCsv(buf: Buffer): ReadRow[] {
  const text = decodeText(buf);
  if (text.includes("\u0000")) throw new ReadError("This doesn't look like a CSV or Excel file.");
  const delim = guessDelimiter(text);
  const rows: ReadRow[] = [];
  let line = 1;
  let rowStart = 1;
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delim) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ line: rowStart, cells });
      if (rows.length > MAX_ROWS + 1) break;
      cells = [];
      cell = "";
      line++;
      rowStart = line;
    } else cell += ch;
  }
  if (quoted) throw new ReadError(`A quote (") opened on line ${rowStart} is never closed. Check that row.`);
  if (cell !== "" || cells.length) {
    cells.push(cell);
    rows.push({ line: rowStart, cells });
  }
  return finish(rows);
}
