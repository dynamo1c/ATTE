import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EntryCell, StatusPill } from "@/components/marks";
import { Card, Empty, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { canEnterMarks, canViewClass } from "@/lib/auth/permissions";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { formatEntry, formatMark } from "@/lib/domain/marks";
import { requireStaff } from "@/server/current";
import { getMarkRoster, getOfferingMarks, getOrCreateAssessment } from "@/server/marks-data";
import { parseId } from "@/server/queries";
import { publishMarks } from "../../actions";
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
  const canEdit = canEnterMarks(me.actor, { classRef: ctx.classRef, assignedStaffIds: part.assignedStaffIds });

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
        <Empty>Not started yet. Entered by {part.assignedNames ?? "the subject teacher"}.</Empty>
      </>
    );
  }

  const roster = await getMarkRoster(a.id, ctx.classRef.id, a.heldOn);
  const editable = canEdit;
  const missing = roster.filter((r) => !r.former && !r.entry).length;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`Out of ${formatMark(part.maxMarks)}${a.heldOn ? ` · held ${formatDateShort(a.heldOn)}` : ""} · ${part.isFinal ? "final exam · " : ""}${part.assignedNames ?? "no teacher assigned"}`}
        back={back}
        actions={<StatusPill status={a.status} />}
      />

      {a.statusNote && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{a.statusNote}</p>}

      <div className="mb-4 flex flex-wrap items-start gap-2">
        {canEdit && a.status !== "PUBLISHED" && (
          <ActionForm action={publishMarks} confirm="All marks entered? Parents will see them on the portal and get a WhatsApp message. You can still correct marks afterwards.">
            <input type="hidden" name="assessmentId" value={a.id} />
            <input type="hidden" name="version" value={a.version} />
            <SubmitButton disabled={missing > 0} title={missing ? `${missing} students have no mark yet` : undefined}>
              Done – show to parents
            </SubmitButton>
          </ActionForm>
        )}
        {canEdit && a.status !== "PUBLISHED" && (
          <span className="self-center text-sm text-slate-500">
            {missing > 0
              ? `Save as often as you like; parents see nothing yet. ${missing} student${missing === 1 ? "" : "s"} still without a mark (enter a mark, AB or MP for everyone first).`
              : "Saved marks stay private until you press Done."}
          </span>
        )}
        {a.status === "PUBLISHED" && (
          <span className="self-center text-sm text-slate-500">
            Shown to parents.{canEdit ? " You can still correct a mark: save, and parents see the change (no new message)." : ""}
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
        <Card title={a.status === "PUBLISHED" ? "Marks (shown to parents)" : "Marks (being entered, not shown to parents yet)"}>
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
