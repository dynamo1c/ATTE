/**
 * Register number: college code (3 digits) + department (2 letters) + admission year (2 digits) + roll (3 digits).
 * Example: 204CS25012 → college 204, CS, admitted 2025, roll 12.
 *
 * The year is the ADMISSION year. Never use it to decide which class a student is in today
 * (detained / lateral-entry students differ) — use class_membership.
 */
const REG_NO = /^(\d{3})([A-Z]{2})(\d{2})(\d{3})$/;

export interface RegNo {
  collegeCode: string;
  departmentCode: string;
  admissionYear: number;
  roll: number;
}

export type RegNoResult = { ok: true; value: RegNo } | { ok: false; error: string };

/** Accepts lowercase and surrounding/internal spaces (people type "204 cs 25 012"). */
export function normalizeRegNo(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function parseRegNo(
  input: string,
  opts: { collegeCode?: string; departmentCodes?: readonly string[] } = {},
): RegNoResult {
  const normalized = normalizeRegNo(input);
  const m = REG_NO.exec(normalized);
  if (!m) return { ok: false, error: "Register number must look like 204CS25012" };
  const [, collegeCode, departmentCode, yy, roll] = m;
  if (opts.collegeCode && collegeCode !== opts.collegeCode) {
    return { ok: false, error: `College code must be ${opts.collegeCode}` };
  }
  if (opts.departmentCodes && !opts.departmentCodes.includes(departmentCode)) {
    return { ok: false, error: `Unknown department code ${departmentCode}` };
  }
  const rollNo = Number(roll);
  if (rollNo === 0) return { ok: false, error: "Roll number cannot be 000" };
  return { ok: true, value: { collegeCode, departmentCode, admissionYear: 2000 + Number(yy), roll: rollNo } };
}

export function formatRegNo(r: RegNo): string {
  const yy = String(r.admissionYear % 100).padStart(2, "0");
  return `${r.collegeCode}${r.departmentCode}${yy}${String(r.roll).padStart(3, "0")}`;
}
