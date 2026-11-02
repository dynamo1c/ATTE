/**
 * Shared pieces of the import checks (docs/PLAN.md §13 phase 10): finding the header row, reading
 * typed cells, and the result every import kind produces. Pure, so every rule is unit-tested.
 */
import { normalizeIndianMobile } from "@/lib/domain/phone";
import { isIsoDate } from "@/lib/domain/dates";
import type { ReadRow } from "@/lib/sheet-read";

export interface Column<K extends string = string> {
  key: K;
  label: string;
  /** Other headings people use for the same thing. */
  aliases?: readonly string[];
  required?: boolean;
  /** What to type, shown in the template's instructions. */
  help: string;
  example: string;
}

export interface Issue {
  /** Row in the file; null = about the whole file. */
  line: number | null;
  message: string;
}

/** One row's outcome, shown in the preview. */
export interface PlanItem {
  line: number;
  action: "create" | "update" | "same";
  label: string;
  changes: string[];
}

export interface Plan<Op> {
  errors: Issue[];
  warnings: Issue[];
  items: PlanItem[];
  ops: Op[];
}

export const emptyPlan = <Op>(): Plan<Op> => ({ errors: [], warnings: [], items: [], ops: [] });

export const headingKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface DataRow<K extends string> {
  line: number;
  get: (key: K) => string;
}

const HEADER_SEARCH_ROWS = 15;

/**
 * Finds the header row (the first of the top rows naming at least two known columns, so a title above
 * it is fine) and turns the rows under it into cells by column key.
 */
export function readColumns<K extends string>(rows: readonly ReadRow[], columns: readonly Column<K>[]): { rows: DataRow<K>[]; errors: Issue[]; warnings: Issue[] } {
  const byHeading = new Map<string, K>();
  for (const c of columns) for (const h of [c.label, ...(c.aliases ?? [])]) byHeading.set(headingKey(h), c.key);
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const headerAt = rows.slice(0, HEADER_SEARCH_ROWS).findIndex((r) => new Set(r.cells.map((c) => byHeading.get(headingKey(c))).filter(Boolean)).size >= Math.min(2, columns.length));
  if (headerAt < 0) {
    errors.push({ line: null, message: `No heading row found. The first row must have the column names from the template (${columns.filter((c) => c.required).map((c) => c.label).join(", ")}).` });
    return { rows: [], errors, warnings };
  }
  const header = rows[headerAt];
  const index = new Map<K, number>();
  header.cells.forEach((cell, i) => {
    if (!cell) return;
    const key = byHeading.get(headingKey(cell));
    if (!key) warnings.push({ line: header.line, message: `Column “${cell}” is not used and was ignored.` });
    else if (index.has(key)) errors.push({ line: header.line, message: `Column “${cell}” appears twice.` });
    else index.set(key, i);
  });
  const missing = columns.filter((c) => c.required && !index.has(c.key));
  if (missing.length) errors.push({ line: header.line, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((c) => c.label).join(", ")}.` });

  const data = rows.slice(headerAt + 1).map((r) => ({
    line: r.line,
    get: (key: K) => {
      const i = index.get(key);
      return i === undefined ? "" : (r.cells[i] ?? "");
    },
  }));
  if (!errors.length && data.length === 0) errors.push({ line: null, message: "The file has headings but no rows under them." });
  return { rows: data, errors, warnings };
}

// ---------------------------------------------------------------------------
// Cell readers. Each returns the value, or an error message for the row.
// ---------------------------------------------------------------------------

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const bad = (error: string): Read<never> => ({ ok: false, error });

const word = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Matches a cell against named choices (case, spaces and punctuation ignored). */
export function choice<T>(raw: string, label: string, options: Record<string, T>): Read<T> {
  const w = word(raw);
  for (const [k, v] of Object.entries(options)) if (word(k) === w) return ok(v);
  const names = [...new Set(Object.keys(options))].slice(0, 6).join(", ");
  return bad(`${label} “${raw}” is not one of: ${names}.`);
}

export function yesNo(raw: string, label: string, fallback: boolean): Read<boolean> {
  if (!raw) return ok(fallback);
  return choice(raw, label, { Yes: true, Y: true, True: true, 1: true, No: false, N: false, False: false, 0: false });
}

export function mobile(raw: string, label: string): Read<string> {
  const r = normalizeIndianMobile(raw.replace(/\.0$/, ""));
  return r.ok ? ok(r.value) : bad(`${label}: ${r.error.toLowerCase()} (“${raw}”).`);
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Dates as people type them in India: 14/05/2008, 14-05-2008, 14.05.2008, 14-May-2008, 2008-05-14, or
 * an Excel date cell (a serial number). Day comes first: 05/06/2008 is 5 June, never May 6.
 * (A date cell is only as right as the PC's date setting; 14-May-2008 can't be misread anywhere.)
 */
export function dateCell(raw: string, label: string): Read<string> {
  let y: number, m: number, d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[\s/.-]*([A-Za-z]{3,9})[\s/.,-]*(\d{4})$/.exec(raw)) && MONTHS.indexOf(r[2].slice(0, 3).toLowerCase()) >= 0) {
    [d, m, y] = [Number(r[1]), MONTHS.indexOf(r[2].slice(0, 3).toLowerCase()) + 1, Number(r[3])];
  }
  else if (/^\d{4,5}(\.\d+)?$/.test(raw) && Number(raw) > 1000 && Number(raw) < 80000) {
    return ok(new Date(EXCEL_EPOCH + Math.floor(Number(raw)) * 86_400_000).toISOString().slice(0, 10));
  } else return bad(`${label} “${raw}” is not a date. Use day/month/year, e.g. 14/05/2008.`);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (!isIsoDate(iso) || Number.isNaN(dt.getTime()) || dt.getUTCDate() !== d || dt.getUTCMonth() + 1 !== m) return bad(`${label} “${raw}” is not a real date.`);
  return ok(iso);
}

export function wholeNumber(raw: string, label: string, min: number, max: number): Read<number> {
  const s = raw.replace(/^(sem(ester)?|p(eriod)?)\s*/i, "").replace(/\.0+$/, "");
  if (!/^\d+$/.test(s) || Number(s) < min || Number(s) > max) return bad(`${label} must be a number from ${min} to ${max} (found “${raw}”).`);
  return ok(Number(s));
}

export function textCell(raw: string, label: string, max: number, required: boolean): Read<string | null> {
  if (!raw) return required ? bad(`${label} is empty.`) : ok(null);
  if (raw.length > max) return bad(`${label} is longer than ${max} characters.`);
  // A leading = + @ makes Excel treat exported text as a formula; nobody's name starts that way.
  if (/^[=+@]/.test(raw)) return bad(`${label} “${raw.slice(0, 20)}” starts with “${raw[0]}”. Remove it.`);
  return ok(raw);
}

/** Collects row errors while reading cells, so one pass reports every problem in the row. */
export class RowReader {
  errors: string[] = [];
  take<T>(r: Read<T>): T | undefined {
    if (r.ok) return r.value;
    this.errors.push(r.error);
    return undefined;
  }
}

/** "Name → New Name" style change lines for the preview. */
export function changeLine(label: string, before: unknown, after: unknown): string {
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(blank)" : String(v));
  return `${label}: ${show(before)} → ${show(after)}`;
}

/** Marks lines that share a key (same phone, same register number) as errors. */
export function duplicates<T>(rows: readonly { line: number; key: T | undefined }[], what: (key: T) => string): Issue[] {
  const seen = new Map<T, number>();
  const issues: Issue[] = [];
  for (const r of rows) {
    if (r.key === undefined) continue;
    const first = seen.get(r.key);
    if (first === undefined) seen.set(r.key, r.line);
    else issues.push({ line: r.line, message: `${what(r.key)} is also on row ${first}. Each must appear once.` });
  }
  return issues;
}
