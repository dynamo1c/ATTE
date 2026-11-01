/**
 * Marks calculation (docs/PLAN.md §7). Pure functions only — every rule here has unit tests.
 *
 * Confirmed by the college:
 * - CIE: every internal part (tests + activity) is summed and scaled: obtained ÷ total max × 50.
 * - SEE: the final exam out of 100 is scaled to 50.
 * - Total = CIE (scaled) + SEE (scaled). Minor subjects have no SEE.
 * - Decimals are kept (no rounding). AB (absent) and MP (malpractice) count as 0.
 * - A part that is not entered yet is NOT zero: the result is "incomplete" until every part is in.
 *
 * Arithmetic is done in hundredths (marks are stored with 2 decimals) so sums are exact.
 */

export type MarkFlag = "AB" | "MP";

export interface SchemePart {
  code: string;
  label: string;
  isFinal: boolean;
  maxMarks: number;
}

/** Stored per scheme (assessment_scheme.formula). */
export interface Formula {
  /** CIE is scaled to this (50). */
  cieOutOf: number;
  /** SEE is scaled to this (50); null when the subject has no final exam. */
  seeOutOf: number | null;
}

export const DEFAULT_FORMULA: Formula = { cieOutOf: 50, seeOutOf: 50 };

export type MarkEntry = { value: number; flag: null } | { value: null; flag: MarkFlag };

export function parseFormula(raw: unknown): Formula {
  const f = raw as Partial<Formula> | null;
  const cie = typeof f?.cieOutOf === "number" && f.cieOutOf > 0 ? f.cieOutOf : DEFAULT_FORMULA.cieOutOf;
  const see = f && "seeOutOf" in f ? (typeof f.seeOutOf === "number" && f.seeOutOf > 0 ? f.seeOutOf : null) : DEFAULT_FORMULA.seeOutOf;
  return { cieOutOf: cie, seeOutOf: see };
}

const hundredths = (n: number) => Math.round(n * 100);

/** Marks obtained for one entry (AB / MP → 0). */
export function obtained(e: MarkEntry): number {
  return e.flag ? 0 : e.value;
}

export interface PartResult {
  /** Sum of obtained marks in the entered parts. */
  obtained: number;
  /** Sum of max marks of the entered parts. */
  enteredMax: number;
  /** Sum of max marks of all parts. */
  totalMax: number;
  entered: number;
  parts: number;
  /** Scaled mark when every part is entered, else null. */
  scaled: number | null;
  /** Scaled from the parts entered so far (for a mid-term view); null when nothing entered. */
  scaledSoFar: number | null;
}

function partResult(parts: readonly SchemePart[], marks: ReadonlyMap<string, MarkEntry>, outOf: number): PartResult {
  let got = 0;
  let enteredMax = 0;
  let totalMax = 0;
  let entered = 0;
  for (const p of parts) {
    totalMax += hundredths(p.maxMarks);
    const m = marks.get(p.code);
    if (!m) continue;
    entered++;
    enteredMax += hundredths(p.maxMarks);
    got += hundredths(obtained(m));
  }
  const scale = (num: number, den: number) => (den === 0 ? null : (num * outOf) / den);
  return {
    obtained: got / 100,
    enteredMax: enteredMax / 100,
    totalMax: totalMax / 100,
    entered,
    parts: parts.length,
    scaled: parts.length > 0 && entered === parts.length ? scale(got, totalMax) : null,
    scaledSoFar: entered > 0 ? scale(got, enteredMax) : null,
  };
}

export interface SubjectResult {
  cie: PartResult;
  /** Null when the subject has no final exam. */
  see: PartResult | null;
  cieOutOf: number;
  seeOutOf: number | null;
  /** cieOutOf + (seeOutOf ?? 0). */
  outOf: number;
  /** CIE + SEE when everything is entered, else null. */
  total: number | null;
  complete: boolean;
  /** Codes not entered yet. */
  missing: string[];
}

export function computeSubjectResult(parts: readonly SchemePart[], marks: ReadonlyMap<string, MarkEntry>, formula: Formula): SubjectResult {
  const ciePartsList = parts.filter((p) => !p.isFinal);
  const seeParts = parts.filter((p) => p.isFinal);
  const hasSee = formula.seeOutOf !== null && seeParts.length > 0;
  const cie = partResult(ciePartsList, marks, formula.cieOutOf);
  const see = hasSee ? partResult(seeParts, marks, formula.seeOutOf!) : null;
  const counted = hasSee ? parts : ciePartsList;
  const missing = counted.filter((p) => !marks.has(p.code)).map((p) => p.code);
  const complete = missing.length === 0 && counted.length > 0;
  const total = complete ? (cie.scaled ?? 0) + (see?.scaled ?? 0) : null;
  return { cie, see, cieOutOf: formula.cieOutOf, seeOutOf: hasSee ? formula.seeOutOf : null, outOf: formula.cieOutOf + (hasSee ? formula.seeOutOf! : 0), total, complete, missing };
}

/**
 * Display a mark: decimals kept, at most 2 places, trailing zeros dropped, never rounded up
 * (42.666… shows 42.66). Exact values like 37.5 and 42.2 show as is.
 */
export function formatMark(n: number | null): string {
  if (n === null) return "—";
  const truncated = Math.floor(n * 100 + 1e-7) / 100;
  return truncated.toFixed(2).replace(/\.?0+$/, "");
}

/** Below the low-marks level (percent of max)? Flags count as 0. */
export function isLowMark(e: MarkEntry, maxMarks: number, lowPct: number): boolean {
  return hundredths(obtained(e)) * 100 < lowPct * hundredths(maxMarks);
}

/**
 * Parse what a teacher types in a mark cell. Returns null for an empty cell (not entered).
 * Accepts "38", "38.5", "AB"/"A"/"ab" (absent), "MP" (malpractice).
 */
export function parseMarkInput(raw: string, maxMarks: number): { ok: true; entry: MarkEntry | null } | { ok: false; error: string } {
  const s = raw.trim().toUpperCase();
  if (s === "") return { ok: true, entry: null };
  if (s === "AB" || s === "A") return { ok: true, entry: { value: null, flag: "AB" } };
  if (s === "MP") return { ok: true, entry: { value: null, flag: "MP" } };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Use a number (up to 2 decimals), AB or MP" };
  const v = Number(s);
  if (v > maxMarks) return { ok: false, error: `More than ${formatMark(maxMarks)}` };
  return { ok: true, entry: { value: v, flag: null } };
}

export function formatEntry(e: MarkEntry | undefined | null): string {
  if (!e) return "";
  return e.flag ?? formatMark(e.value);
}
