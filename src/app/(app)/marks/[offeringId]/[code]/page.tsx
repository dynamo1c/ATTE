import { notFound } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { EntryCell, StatusPill } from "@/components/marks";
import { Card, Empty, Input, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { canEnterMarks, canPublishMarks, canViewClass } from "@/lib/auth/permissions";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { formatEntry, formatMark } from "@/lib/domain/marks";
import { requireStaff } from "@/server/current";
import { getMarkRoster, getOfferingMarks, getOrCreateAssessment } from "@/server/marks-data";
import { parseId } from "@/server/queries";
import { publishMarks, reopenMarks, sendBackMarks, submitMarks } from "../../actions";
import { MarkEntry } from "./entry";

export const metadata = { title: "Enter marks · MEI Attendance" };

export default async function MarkEntryPage(props: PageProps<"/marks/[offeringId]/[code]">) {
  const me = await requireStaff();
  const params = await props.params;
  const offeringId = parseId(params.offeringId);
  let ctx = offeringId ? await getOfferingMarks(offeringId) : null;
  if (!ctx) notFound();
  if (!canViewClass(me.actor, ctx.classRef)) return <NoAccess what="this subject" />;
  let part = ctx.parts.find((p) => p.code === params.code);
  if (!part) notFound();
  const canEdit = canEnterMarks(me.actor, { classRef: ctx.classRef, isFinal: part.isFinal, assignedStaffIds: part.assignedStaffIds });
  const publisher = canPublishMarks(me.actor, ctx.classRef);

  // First visit by someone who enters these marks: create the test row (safe if two people do it at once).
  if (!part.assessment && canEdit) {
    await getOrCreateAssessment(ctx.offeringId, part);
    ctx = (await getOfferingMarks(ctx.offeringId))!;
    part = ctx.parts.find((p) => p.code === params.code)!;
  }
  const title = `${ctx.className} · ${ctx.subject} · ${part.label}`;
  const back = { href: `/marks/${ctx.offeringId}`, label: `${ctx.className} · ${ctx.subject}` };
  const a = part.assessment;
  if (!a) {
    return (
      <>
        <PageHeader title={title} back={back} />
        <Empty>Not started yet. {part.isFinal ? "The HOD enters final exam marks." : `Entered by ${part.assignedNames ?? "the subject teacher"}.`}</Empty>
      </>
    );
  }

  const roster = await getMarkRoster(a.id, ctx.classRef.id, a.heldOn);
  const editable = canEdit && (a.status === "DRAFT" || (a.status === "SUBMITTED" && publisher));
  const missing = roster.filter((r) => !r.former && !r.entry).length;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`Out of ${formatMark(part.maxMarks)}${a.heldOn ? ` · held ${formatDateShort(a.heldOn)}` : ""} · ${part.isFinal ? "final exam, entered by HOD" : (part.assignedNames ?? "no teacher assigned")}`}
        back={back}
        actions={<StatusPill status={a.status} />}
      />

      {a.statusNote && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{a.statusNote}</p>}

      <div className="mb-4 flex flex-wrap items-start gap-2">
        {canEdit && a.status === "DRAFT" && !publisher && (
          <ActionForm action={submitMarks} confirm="Send these marks to the HOD? You can't change them after that unless the HOD sends them back.">
            <input type="hidden" name="assessmentId" value={a.id} />
            <input type="hidden" name="version" value={a.version} />
            <SubmitButton variant="secondary" disabled={missing > 0} title={missing ? `${missing} students have no mark yet` : undefined}>
              Submit to HOD
            </SubmitButton>
          </ActionForm>
        )}
        {publisher && (a.status === "DRAFT" || a.status === "SUBMITTED") && (
          <ActionForm action={publishMarks} confirm="Publish these marks? Students' parents will be messaged.">
            <input type="hidden" name="assessmentId" value={a.id} />
            <input type="hidden" name="version" value={a.version} />
            <SubmitButton disabled={missing > 0} title={missing ? `${missing} students have no mark yet` : undefined}>
              Publish
            </SubmitButton>
          </ActionForm>
        )}
        {publisher && a.status === "SUBMITTED" && (
          <details className="rounded-md border border-slate-200 bg-white px-3 py-1.5">
            <summary className="cursor-pointer text-sm text-slate-700">Send back to teacher</summary>
            <ActionForm action={sendBackMarks} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="assessmentId" value={a.id} />
              <input type="hidden" name="version" value={a.version} />
              <Field label="What needs fixing" name="note">
                <Input id="note" name="note" className="w-64" />
              </Field>
              <SubmitButton size="sm" variant="secondary">
                Send back
              </SubmitButton>
            </ActionForm>
          </details>
        )}
        {publisher && a.status === "PUBLISHED" && (
          <details className="rounded-md border border-slate-200 bg-white px-3 py-1.5">
            <summary className="cursor-pointer text-sm text-slate-700">Reopen to correct</summary>
            <ActionForm action={reopenMarks} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="assessmentId" value={a.id} />
              <input type="hidden" name="version" value={a.version} />
              <Field label="Reason (recorded)" name="note">
                <Input id="note" name="note" className="w-64" placeholder="Re-evaluation of roll 12" />
              </Field>
              <SubmitButton size="sm" variant="danger">
                Reopen
              </SubmitButton>
            </ActionForm>
          </details>
        )}
        {missing > 0 && (canEdit || publisher) && a.status !== "PUBLISHED" && (
          <span className="self-center text-sm text-slate-500">
            {missing} student{missing === 1 ? "" : "s"} still without a mark — every student needs a mark, AB or MP before {publisher ? "publishing" : "submitting"}.
          </span>
        )}
      </div>

      {editable ? (
        <MarkEntry
          key={`${a.id}-${a.version}`}
          assessment={{ id: a.id, version: a.version, heldOn: a.heldOn }}
          maxMarks={part.maxMarks}
          students={roster.map((r) => ({ studentId: r.studentId, regNo: r.regNo, name: r.name, roll: r.roll, saved: formatEntry(r.entry), former: r.former }))}
          today={todayIn()}
        />
      ) : (
        <Card title={a.status === "PUBLISHED" ? "Published marks" : a.status === "SUBMITTED" ? "Submitted — waiting for the HOD" : "Marks (read only)"}>
          {roster.length === 0 ? (
            <Empty>No students.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Roll</Th>
                  <Th>Student</Th>
                  <Th className="text-right">Marks / {formatMark(part.maxMarks)}</Th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.studentId} className={r.former ? "opacity-50" : undefined}>
                    <Td className="tabular-nums">{r.roll}</Td>
                    <Td>
                      {r.name}
                      <div className="font-mono text-xs text-slate-500">{r.regNo}</div>
                    </Td>
                    <Td className="text-right">
                      <EntryCell entry={r.entry ?? undefined} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
