"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { assessment, mark, markSubmission } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { canEnterMarks } from "@/lib/auth/permissions";
import { computeSubjectResult, formatEntry, formatMark, isLowMark, type MarkEntry } from "@/lib/domain/marks";
import { int } from "@/lib/forms";
import { isIsoDate, todayIn } from "@/lib/domain/dates";
import { dedupeKey } from "@/lib/notify/rules";
import { formAction, toActionError, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure, requireStaff, type CurrentStaff } from "@/server/current";
import { getAssessmentContext, getClassMarks, getMarkRoster } from "@/server/marks-data";
import { enqueueForStudents, loadTriggerSettings, portalLink, type Draft } from "@/server/notify/outbox";
import { getSettings } from "@/server/queries";

const entrySchema = z.object({
  studentId: z.number().int().positive(),
  value: z.number().min(0).max(1000).nullable(),
  flag: z.enum(["AB", "MP"]).nullable(),
});
const saveSchema = z.object({
  assessmentId: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  clientOpId: z.uuid(),
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  marks: z.array(entrySchema).max(500),
});
export type SaveMarksInput = z.input<typeof saveSchema>;
export type SaveMarksResult = NonNullable<ActionState> & { version?: number };

async function load(me: CurrentStaff, assessmentId: number) {
  const found = await getAssessmentContext(assessmentId);
  if (!found) throw new UserError("This test no longer exists. Go back and reload.");
  const { ctx, part } = found;
  ensure(canEnterMarks(me.actor, { classRef: ctx.classRef, assignedStaffIds: part.assignedStaffIds }), "You can't enter marks for this test.");
  return { ctx, part };
}

const sameEntry = (a: MarkEntry | null, b: MarkEntry | null) => (a === null || b === null ? a === b : a.flag === b.flag && a.value === b.value);

/** Called directly from the mark entry screen. Saves the whole list at once, or nothing. */
export async function saveMarks(raw: SaveMarksInput): Promise<SaveMarksResult> {
  const me = await requireStaff();
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid data. Reload the page." };
  const input = parsed.data;
  try {
    const { ctx, part } = await load(me, input.assessmentId);
    const a = part.assessment;
    if (input.heldOn !== null && (!isIsoDate(input.heldOn) || input.heldOn > todayIn())) throw new UserError("The test date can't be in the future.");

    // Validate every entry: one per student, a number with at most 2 decimals within max, or AB / MP.
    const after = new Map<number, MarkEntry | null>();
    for (const m of input.marks) {
      if (after.has(m.studentId)) throw new UserError("A student appears twice. Reload the page.");
      if (m.value !== null && m.flag !== null) throw new UserError("A mark can't be both a number and AB/MP.");
      if (m.value !== null && (m.value > part.maxMarks || Math.round(m.value * 100) !== m.value * 100)) {
        throw new UserError(`Marks must be between 0 and ${formatMark(part.maxMarks)}, with at most 2 decimals.`);
      }
      after.set(m.studentId, m.value !== null ? { value: m.value, flag: null } : m.flag ? { value: null, flag: m.flag } : null);
    }
    const roster = await getMarkRoster(a.id, ctx.classRef.id, input.heldOn ?? a.heldOn);
    const known = new Set(roster.map((r) => r.studentId));
    const missing = roster.filter((r) => !after.has(r.studentId));
    const extra = [...after.keys()].filter((id) => !known.has(id));
    if (missing.length || extra.length) throw new UserError("The class list changed since you opened this page. Reload — your marks are kept as a draft.");
    // Once shown to parents, a correction may change a mark but not leave a student without one.
    const blanks = roster.filter((r) => !r.former && !after.get(r.studentId));
    if (a.status === "PUBLISHED" && blanks.length) {
      throw new UserError(`These marks are shown to parents, so every student needs a mark, AB or MP (rolls ${blanks.slice(0, 8).map((r) => r.roll).join(", ")}).`);
    }

    const changes = roster
      .filter((r) => !sameEntry(r.entry, after.get(r.studentId)!))
      .map((r) => ({ studentId: r.studentId, from: formatEntry(r.entry) || null, to: formatEntry(after.get(r.studentId)) || null }));
    const toUpsert = roster.filter((r) => after.get(r.studentId) && !sameEntry(r.entry, after.get(r.studentId)!)).map((r) => ({ studentId: r.studentId, entry: after.get(r.studentId)! }));
    const toDelete = roster.filter((r) => r.entry && after.get(r.studentId) === null).map((r) => r.studentId);

    const version = await getDb().transaction(async (tx) => {
      const fresh = await tx.insert(markSubmission).values({ clientOpId: input.clientOpId, assessmentId: a.id, staffId: me.id }).onConflictDoNothing().returning();
      if (fresh.length === 0) return null; // a retry of a save that already went through
      const [row] = await tx.select({ version: assessment.version, status: assessment.status }).from(assessment).where(eq(assessment.id, a.id)).for("update");
      if (row.version !== input.version) throw new UserError("Someone else saved these marks just now. Reload to see them — your marks are kept as a draft.");
      if (toDelete.length) await tx.delete(mark).where(and(eq(mark.assessmentId, a.id), inArray(mark.studentId, toDelete)));
      if (toUpsert.length) {
        await tx
          .insert(mark)
          .values(toUpsert.map((u) => ({ assessmentId: a.id, maxMarks: part.maxMarks, studentId: u.studentId, value: u.entry.value, flag: u.entry.flag, enteredBy: me.id, enteredAt: new Date() })))
          .onConflictDoUpdate({
            target: [mark.assessmentId, mark.studentId],
            set: { value: sql`excluded.value`, flag: sql`excluded.flag`, enteredBy: sql`excluded.entered_by`, enteredAt: sql`excluded.entered_at` },
          });
      }
      const [updated] = await tx
        .update(assessment)
        .set({ heldOn: input.heldOn ?? a.heldOn, version: sql`${assessment.version} + 1`, updatedAt: new Date() })
        .where(eq(assessment.id, a.id))
        .returning({ version: assessment.version });
      await audit(tx, { actorStaffId: me.id, action: a.status === "PUBLISHED" ? "CORRECT_MARKS" : "ENTER_MARKS", entity: "assessment", entityId: a.id, after: { heldOn: input.heldOn, changes } });
      return updated.version;
    });
    revalidatePath("/marks");
    if (version === null) return { ok: true, message: "Already saved." };
    const entered = [...after.values()].filter(Boolean).length;
    const shown = a.status === "PUBLISHED" ? " Parents see the corrected marks (no new message)." : "";
    return { ok: true, version, message: `Saved: ${entered} of ${roster.length} entered${changes.length ? `, ${changes.length} changed` : ""}.${shown}` };
  } catch (e) {
    unstable_rethrow(e);
    return toActionError(e);
  }
}

/** Everyone expected on the test date has a mark (or AB/MP). */
async function requireComplete(classId: number, a: { id: number; heldOn: string | null }) {
  if (!a.heldOn) throw new UserError("Set the test date first.");
  const roster = await getMarkRoster(a.id, classId, a.heldOn);
  const missing = roster.filter((r) => !r.former && !r.entry);
  if (missing.length) throw new UserError(`${missing.length} student${missing.length === 1 ? " has" : "s have"} no mark yet (rolls ${missing.slice(0, 8).map((r) => r.roll).join(", ")}${missing.length > 8 ? "…" : ""}). Enter a mark, AB or MP for everyone.`);
  return roster;
}

const statusSchema = z.object({ assessmentId: int("Test"), version: int("Version") });

/**
 * "Done – show to parents": the teacher has entered everyone's marks. Parents see them on the portal and
 * get one WhatsApp per test (dedupe key per test and student). Marks stay editable afterwards.
 */
export const publishMarks = formAction(statusSchema, async ({ assessmentId, version }, { me }) => {
  const { ctx, part } = await load(me, assessmentId);
  const roster = await requireComplete(ctx.classRef.id, part.assessment);

  // Parent messages: the mark, internal marks so far (published parts including this one), low marks flagged.
  const [settings, triggers, published] = await Promise.all([getSettings(), loadTriggerSettings(getDb()), getClassMarks(ctx.classRef.id, { publishedOnly: true })]);
  const subject = published.subjects.find((s) => s.offeringId === ctx.offeringId)!;
  const link = portalLink();
  const drafts: Draft[] = [];
  for (const r of roster) {
    if (r.former || !r.entry) continue;
    const trigger = isLowMark(r.entry, part.maxMarks, settings.lowMarksPct) ? "LOW_MARKS" : "MARKS_PUBLISHED";
    if (!triggers[trigger]) continue;
    const marks = new Map(published.students.find((s) => s.studentId === r.studentId)?.subjects.get(ctx.offeringId)?.marks ?? []);
    marks.set(part.code, r.entry);
    const result = computeSubjectResult(subject.parts, marks, subject.formula);
    drafts.push({
      trigger,
      studentId: r.studentId,
      data: {
        kind: trigger,
        student: { name: r.name, regNo: r.regNo, className: ctx.className },
        subject: ctx.subject,
        partCode: part.code,
        partLabel: part.label,
        mark: formatEntry(r.entry),
        maxMarks: formatMark(part.maxMarks),
        cieSoFar: part.isFinal ? null : formatMark(result.cie.scaledSoFar),
        cieOutOf: result.cieOutOf,
        link,
      },
      key: (cid) => dedupeKey.marks(assessmentId, r.studentId, cid),
    });
  }

  const queued = await getDb().transaction(async (tx) => {
    const done = await tx
      .update(assessment)
      .set({ status: "PUBLISHED", statusNote: null, publishedBy: me.id, publishedAt: new Date(), version: sql`${assessment.version} + 1`, updatedAt: new Date() })
      .where(and(eq(assessment.id, assessmentId), eq(assessment.version, version), eq(assessment.status, "DRAFT")))
      .returning({ id: assessment.id });
    if (!done.length) throw new UserError("These marks changed meanwhile. Reload.");
    await audit(tx, { actorStaffId: me.id, action: "PUBLISH_MARKS", entity: "assessment", entityId: assessmentId });
    return enqueueForStudents(tx, drafts, { createdBy: me.id });
  });
  revalidatePath("/marks");
  return { ok: true, message: `Shown to parents.${queued ? ` ${queued} message${queued === 1 ? "" : "s"} queued.` : ""} You can still correct marks here.` };
});
