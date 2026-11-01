import { notFound } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, NoAccess, PageHeader } from "@/components/ui";
import { canEditLockedAttendance } from "@/lib/auth/permissions";
import { formatDateLong, formatDateShort, todayIn } from "@/lib/domain/dates";
import { editableUntil, lockState, rollLabels } from "@/lib/domain/marking";
import { getRoster, getSessionContext, sessionPermission } from "@/server/attendance-data";
import { requireStaff } from "@/server/current";
import { getSettings, parseId } from "@/server/queries";
import { markNotHeld, reopenSession } from "../actions";
import { Marker } from "./marker";

export const metadata = { title: "Take attendance · MEI Attendance" };

const LEAVE_LABEL: Record<string, string> = { MEDICAL: "Medical leave", ON_DUTY: "On duty", PERSONAL: "Leave", OTHER: "Leave" };

export default async function MarkPage(props: PageProps<"/attendance/[id]">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  const s = id ? await getSessionContext(id) : null;
  if (!s) notFound();
  if (!sessionPermission(me.actor, s)) return <NoAccess what="this class's attendance" />;

  const [settings, roster] = await Promise.all([getSettings(), getRoster(s)]);
  const today = todayIn();
  const lock = lockState(s.date, today, settings.attendanceLockDays);
  const override = canEditLockedAttendance(me.actor, s.classRef);
  const labels = rollLabels(roster);

  const title = `${s.subject}${s.component === "PRACTICAL" ? " Lab" : ""} · ${s.className}${s.batchScope !== "ALL" ? ` ${s.batchScope}` : ""}`;
  const subtitle = `${formatDateLong(s.date)} · ${s.startsAt}–${s.endsAt} · ${s.assignedNames ?? "No teacher assigned"}`;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} back={{ href: "/attendance", label: "Attendance" }} />

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {s.status === "HELD" && <Badge tone="green">Entered by {s.markedBy} · {s.markedAt}</Badge>}
        {lock === "OPEN" && <Badge tone="blue">Editable until {formatDateShort(editableUntil(s.date, settings.attendanceLockDays))}</Badge>}
        {lock === "LOCKED" && <Badge tone={override ? "amber" : "red"}>{override ? "Edit window closed. As HOD/admin you can still change it" : "Edit window closed. Changes go to the HOD"}</Badge>}
        {!s.assignedStaffIds.includes(me.id) && <Badge tone="violet">You are marking as substitute / HOD</Badge>}
      </div>

      {s.status === "CANCELLED" ? (
        <Card>
          <p className="text-sm text-slate-700">This class was cancelled{s.statusReason ? `: ${s.statusReason}` : "."} It doesn&apos;t count in attendance.</p>
        </Card>
      ) : lock === "FUTURE" ? (
        <Card>
          <p className="text-sm text-slate-700">This class is on {formatDateLong(s.date)}. Attendance opens on that day.</p>
        </Card>
      ) : s.status === "NOT_HELD" ? (
        <Card>
          <p className="text-sm text-slate-700">Marked as not held{s.statusReason ? `: ${s.statusReason}` : ""}. It doesn&apos;t count in attendance.</p>
          {(lock === "OPEN" || override) && (
            <ActionForm action={reopenSession} className="mt-3">
              <input type="hidden" name="sessionId" value={s.id} />
              <input type="hidden" name="version" value={s.version} />
              <SubmitButton variant="secondary" size="sm">
                It was held — take attendance
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      ) : (
        <>
          <Marker
            session={{ id: s.id, version: s.version, status: s.status }}
            students={roster.map((r) => ({
              studentId: r.studentId,
              regNo: r.regNo,
              name: r.name,
              label: labels.get(r.studentId)!,
              mark: r.mark,
              leave: r.leave ? LEAVE_LABEL[r.leave] ?? "Leave" : null,
            }))}
            mode={lock === "LOCKED" && !override ? "request" : "save"}
          />
          {(lock === "OPEN" || override) && (
            <details className="mt-6 max-w-xl">
              <summary className="cursor-pointer text-sm text-slate-600">Class didn&apos;t happen?</summary>
              <ActionForm action={markNotHeld} confirm="Mark this class as not held? Any marks entered for it are removed (kept in history)." className="mt-3 space-y-3">
                <input type="hidden" name="sessionId" value={s.id} />
                <input type="hidden" name="version" value={s.version} />
                <Field label="Reason" name="reason">
                  <Input id="reason" name="reason" placeholder="Teacher on leave / exam duty / power cut" />
                </Field>
                <SubmitButton variant="danger" size="sm">
                  Mark as not held
                </SubmitButton>
              </ActionForm>
            </details>
          )}
        </>
      )}
    </>
  );
}
