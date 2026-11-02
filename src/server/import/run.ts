import "server-only";
/**
 * Import flow (docs/PLAN.md §13 phase 10): the same file is sent twice.
 *
 *   check  read the file, compare every row with the saved data, write nothing, show the result
 *   apply  only after a clean check of the very same file and options: take the import lock, check
 *          again inside the transaction, and write everything or nothing
 *
 * If anything changed in between (someone edited data, a different file), apply refuses and asks for
 * a new check, so what gets saved is always exactly what the person looked at.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, type DbTx } from "@/db/client";
import { auditLog } from "@/db/schema";
import { canImport } from "@/lib/auth/permissions";
import { generateTempPassword, hashPassword } from "@/lib/auth/password";
import { isIsoDate, todayIn, type IsoDate } from "@/lib/domain/dates";
import type { Issue, Plan, PlanItem } from "@/lib/import/columns";
import { planStaff } from "@/lib/import/staff";
import { planStudents } from "@/lib/import/students";
import { planSubjects } from "@/lib/import/subjects";
import { planTimetable } from "@/lib/import/timetable";
import { readTable, type ReadRow } from "@/lib/sheet-read";
import type { CurrentStaff } from "../current";
import { forgetGeneratedSessions } from "../generate-sessions";
import { mapLimit } from "../queries";
import { applyStaff, applyStudents, applySubjects, applyTimetable, AuditBatch } from "./apply";
import { staffContext, studentContext, subjectContext, timetableContext } from "./context";

export const IMPORT_KINDS = ["staff", "subjects", "students", "timetable"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const isImportKind = (k: string): k is ImportKind => (IMPORT_KINDS as readonly string[]).includes(k);

export interface ImportRequest {
  kind: ImportKind;
  mode: "check" | "apply";
  file: { name: string; bytes: Uint8Array };
  termId: number;
  /** Students: date they join the class. */
  joinedOn?: string;
  /** Timetable: date it starts. */
  effectiveFrom?: string;
  /** Apply only: the fingerprint and counts the check returned. */
  checked?: { fingerprint: string; counts: string };
}

export type ImportResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      mode: "check" | "apply";
      fingerprint: string;
      counts: { create: number; update: number; same: number };
      errors: Issue[];
      warnings: Issue[];
      items: PlanItem[];
      /** Apply of a staff import: the new accounts' temporary passwords, shown once. */
      passwords?: { name: string; phone: string; password: string }[];
    };

const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('mei-import'))`;

class Changed extends Error {}

const countsOf = (items: readonly PlanItem[]) => ({
  create: items.filter((i) => i.action === "create").length,
  update: items.filter((i) => i.action === "update").length,
  same: items.filter((i) => i.action === "same").length,
});
const countsKey = (c: ReturnType<typeof countsOf>) => `${c.create}/${c.update}/${c.same}`;

type AnyPlan = Plan<unknown>;

export async function runImport(me: CurrentStaff, req: ImportRequest): Promise<ImportResponse> {
  if (!canImport(me.actor)) return { ok: false, error: "Only the admin can import files." };
  const db = getDb();
  const [term] = (await db.execute<{ id: number; startsOn: string; endsOn: string; label: string }>(sql`
    SELECT t.id, to_char(t.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(t.ends_on, 'YYYY-MM-DD') AS "endsOn", y.label || ' ' || t.kind AS label
    FROM term t JOIN academic_year y ON y.id = t.academic_year_id WHERE t.id = ${req.termId}`)).rows;
  if (!term) return { ok: false, error: "Choose the term." };
  const today = todayIn();

  const date = (v: string | undefined, label: string): IsoDate | { error: string } => {
    if (!v || !isIsoDate(v)) return { error: `Choose the ${label}.` };
    if (v < term.startsOn || v > term.endsOn) return { error: `The ${label} must be within the term (${term.startsOn} to ${term.endsOn}).` };
    return v;
  };
  let joinedOn: IsoDate | undefined;
  let effectiveFrom: IsoDate | undefined;
  if (req.kind === "students") {
    const d = date(req.joinedOn, "date students join their class");
    if (typeof d !== "string") return { ok: false, error: d.error };
    joinedOn = d;
  }
  if (req.kind === "timetable") {
    const d = date(req.effectiveFrom, "date the timetable starts");
    if (typeof d !== "string") return { ok: false, error: d.error };
    effectiveFrom = d;
  }

  const read = readTable(req.file.bytes, req.file.name);
  if (!read.ok) return { ok: false, error: read.error };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([req.kind, req.termId, joinedOn ?? "", effectiveFrom ?? ""]))
    .update(req.file.bytes)
    .digest("hex")
    .slice(0, 32);

  const plan = (tx: Parameters<typeof staffContext>[0]): Promise<AnyPlan> => makePlan(tx, req.kind, read.rows, term, today, effectiveFrom);
  const outside = await plan(db);
  const counts = countsOf(outside.items);
  const response = (p: AnyPlan, mode: "check" | "apply", extra: Partial<Extract<ImportResponse, { ok: true }>> = {}): ImportResponse => ({
    ok: true,
    mode,
    fingerprint,
    counts: countsOf(p.items),
    errors: p.errors,
    warnings: p.warnings,
    items: p.items,
    ...extra,
  });
  if (req.mode === "check" || outside.errors.length) return response(outside, "check");

  if (!req.checked || req.checked.fingerprint !== fingerprint) return { ok: false, error: "The file or the options changed since the check. Press “Check file” again." };
  if (req.checked.counts !== countsKey(counts)) return { ok: false, error: "The saved data changed since your check (someone else made changes). Press “Check file” again." };
  if (outside.ops.length === 0) return { ok: false, error: "Nothing to import: every row already matches what is saved." };

  // Staff: hash the new accounts' passwords before taking the lock (hashing is deliberately slow).
  const passwords: { name: string; phone: string; password: string; hash: string }[] = [];
  if (req.kind === "staff") {
    const creates = (outside.ops as Awaited<ReturnType<typeof planStaff>>["ops"]).filter((o) => o.kind === "create");
    passwords.push(
      ...(await mapLimit(creates, 4, async (o) => {
        const password = generateTempPassword();
        return { name: o.values.name, phone: o.values.phone, password, hash: await hashPassword(password) };
      })),
    );
  }

  const reason = `Import ${req.kind} from “${req.file.name.slice(0, 100)}”`;
  try {
    const final = await db.transaction(async (tx) => {
      await tx.execute(LOCK);
      const p = await plan(tx);
      if (p.errors.length || countsKey(countsOf(p.items)) !== countsKey(counts)) throw new Changed();
      const log = new AuditBatch(me.id, reason);
      await applyPlan(tx, req.kind, p, { termId: term.id, joinedOn, passwords: new Map(passwords.map((x) => [x.phone, x.hash])), me, note: reason }, log);
      await log.flush(tx);
      await tx.insert(auditLog).values({
        actorStaffId: me.id,
        action: "IMPORT",
        entity: "import",
        entityId: req.kind,
        after: { file: req.file.name, fingerprint, term: term.label, joinedOn, effectiveFrom, counts: countsOf(p.items), rows: read.rows.length },
        reason,
      });
      return p;
    });
    if (req.kind === "timetable" || req.kind === "subjects") forgetGeneratedSessions();
    return response(final, "apply", req.kind === "staff" ? { passwords: passwords.map(({ hash: _h, ...p }) => p) } : {});
  } catch (e) {
    if (e instanceof Changed) return { ok: false, error: "The saved data changed while importing (someone else made changes). Nothing was saved. Press “Check file” again." };
    if (e instanceof Error && e.message.startsWith("No password prepared")) return { ok: false, error: "The staff list changed while importing. Nothing was saved. Press “Check file” again." };
    throw e;
  }
}

async function makePlan(
  db: Parameters<typeof staffContext>[0],
  kind: ImportKind,
  rows: readonly ReadRow[],
  term: { id: number; startsOn: string; endsOn: string },
  today: IsoDate,
  effectiveFrom: IsoDate | undefined,
): Promise<AnyPlan> {
  switch (kind) {
    case "staff":
      return planStaff(rows, await staffContext(db, term.id));
    case "subjects":
      return planSubjects(rows, await subjectContext(db, term.id));
    case "students":
      return planStudents(rows, await studentContext(db, term.id, today));
    case "timetable":
      return planTimetable(rows, await timetableContext(db, term, effectiveFrom!, today));
  }
}

async function applyPlan(
  tx: DbTx,
  kind: ImportKind,
  plan: AnyPlan,
  o: { termId: number; joinedOn?: IsoDate; passwords: Map<string, string>; me: CurrentStaff; note: string },
  log: AuditBatch,
) {
  switch (kind) {
    case "staff":
      return applyStaff(tx, plan.ops as Awaited<ReturnType<typeof planStaff>>["ops"], o.passwords, log);
    case "subjects":
      return applySubjects(tx, plan.ops as ReturnType<typeof planSubjects>["ops"], log);
    case "students":
      return applyStudents(tx, plan.ops as ReturnType<typeof planStudents>["ops"], o.termId, o.joinedOn!, log);
    case "timetable":
      return applyTimetable(tx, plan.ops as ReturnType<typeof planTimetable>["ops"], o.me.id, o.note.slice(0, 200), log);
  }
}
