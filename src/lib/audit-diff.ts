/**
 * Short "what changed" for an audit row: top-level fields whose value differs between before and after.
 * The full before/after JSON stays available on the screen; this is the one-line summary.
 */
export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

const MAX = 60;

export function show(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s;
}

// Housekeeping fields that change on every write and say nothing to a reader.
const IGNORED = new Set(["updatedAt", "updated_at", "version", "createdAt", "created_at"]);

export function changedFields(before: unknown, after: unknown): FieldChange[] {
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  if (!isObj(before) && !isObj(after)) return [];
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const out: FieldChange[] = [];
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (IGNORED.has(field)) continue;
    if (JSON.stringify(b[field]) === JSON.stringify(a[field])) continue;
    out.push({ field, before: show(b[field]), after: show(a[field]) });
  }
  return out;
}
