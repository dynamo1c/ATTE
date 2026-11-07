import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { canDecideStaffLeave, hodDepartmentIds, leaveDecidedBy, staffLeaveScope } from "@/lib/auth/permissions";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { canCancelStaffLeave, DAY_PART, formatLeaveDates, leaveDayCount, STAFF_LEAVE_TYPE, type DayPart, type StaffLeaveStatus, type StaffLeaveType } from "@/lib/domain/staff-leave";
import { requireStaff } from "@/server/current";
import { classesDuringLeaves, getApplicant, type MissedClass } from "@/server/staff-leave-data";
import { applyStaffLeave, cancelStaffLeave, decideStaffLeave } from "./actions";

export const metadata = { title: "Staff leave · MEI Attendance" };

type LeaveRow = {
  id: number;
  staffId: number;
  name: string;
  designation: string | null;
  dept: string | null;
  departmentId: number | null;
  isHod: boolean;
  type: StaffLeaveType;
  fromDate: string;
  toDate: string;
  part: DayPart;
  reason: string;
  status: StaffLeaveStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  appliedOn: string;
};

const STATUS_BADGE: Record<StaffLeaveStatus, React.ReactNode> = {
  PENDING: <Badge tone="amber">Waiting</Badge>,
  APPROVED: <Badge tone="green">Approved</Badge>,
  REJECTED: <Badge tone="red">Rejected</Badge>,
  CANCELLED: <Badge>Cancelled</Badge>,
};

export default async function StaffLeavePage() {
  const me = await requireStaff();
  const today = todayIn();
  const scope = staffLeaveScope(me.actor);
  const depts = hodDepartmentIds(me.actor);
  const filter =
    scope === "ALL"
      ? sql`true`
      : scope === "DEPARTMENTS"
        ? sql`(s.department_id IN (${sql.join(depts.map((d) => sql`${d}`), sql`, `)}) OR l.staff_id = ${me.id})`
        : sql`l.staff_id = ${me.id}`;
  const { rows } = await getDb().execute<LeaveRow>(sql`
    SELECT l.id, l.staff_id AS "staffId", s.name, s.designation, d.code AS dept, s.department_id AS "departmentId",
           EXISTS (SELECT 1 FROM role_grant g WHERE g.staff_id = s.id AND g.role = 'HOD') AS "isHod",
           l.type, to_char(l.from_date, 'YYYY-MM-DD') AS "fromDate", to_char(l.to_date, 'YYYY-MM-DD') AS "toDate", l.part, l.reason, l.status,
           db.name AS "decidedBy", l.decision_note AS "decisionNote", to_char(l.created_at, 'YYYY-MM-DD') AS "appliedOn"
    FROM staff_leave l
    JOIN staff s ON s.id = l.staff_id
    LEFT JOIN department d ON d.id = s.department_id
    LEFT JOIN staff db ON db.id = l.decided_by
    WHERE ${filter}
    ORDER BY l.from_date DESC, l.id DESC
    LIMIT 400`);

  const mine = rows.filter((r) => r.staffId === me.id);
  const others = rows.filter((r) => r.staffId !== me.id);
  const toDecide = others.filter((r) => r.status === "PENDING" && canDecideStaffLeave(me.actor, r)).sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
  const upcoming = others.filter((r) => r.status === "APPROVED" && r.toDate >= today).sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
  const missed = await classesDuringLeaves([...toDecide, ...upcoming]);
  const self = await getApplicant(me.id);
  const decider = leaveDecidedBy(self) === "HOD" ? "your HOD" : "the principal";

  return (
    <>
      <PageHeader
        title={scope === "OWN" ? "My leave" : "Staff leave"}
        subtitle={scope === "OWN" ? `Apply for your own leave. It is decided by ${decider}.` : "Your own leave, and leave of the staff you look after."}
      />

      {toDecide.length > 0 && (
        <Card title={`Waiting for your decision (${toDecide.length})`} className="mb-6">
          <ul className="divide-y divide-slate-100">
            {toDecide.map((r) => (
              <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                <LeaveSummary r={r} />
                <ClassesList classes={missed.get(r.id) ?? []} />
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <ActionForm action={decideStaffLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="APPROVED" />
                    <SubmitButton size="sm">Approve</SubmitButton>
                  </ActionForm>
                  <ActionForm action={decideStaffLeave} className="flex flex-wrap items-start gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="REJECTED" />
                    <Input name="note" aria-label="Reason for rejecting" placeholder="Reason (needed to reject)" className="h-8 w-56 py-1" />
                    <SubmitButton size="sm" variant="danger">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {scope !== "OWN" && (
        <Card title="Approved leave coming up: classes needing a substitute" className="mb-6">
          {upcoming.length === 0 ? (
            <Empty>No approved leave from today on.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <LeaveSummary r={r} />
                  <ClassesList classes={(missed.get(r.id) ?? []).filter((c) => c.date >= today)} open />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card title="Apply for leave">
          <ActionForm action={applyStaffLeave} resetOnSuccess className="space-y-3">
            <Field label="Type" name="type">
              <Select id="type" name="type">
                {Object.entries(STAFF_LEAVE_TYPE).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day" name="fromDate">
                <Input id="fromDate" name="fromDate" type="date" defaultValue={today} />
              </Field>
              <Field label="Last day" name="toDate">
                <Input id="toDate" name="toDate" type="date" defaultValue={today} />
              </Field>
            </div>
            <Field label="Full or half day" name="part" hint="Half days: first and last day the same.">
              <Select id="part" name="part">
                {Object.entries(DAY_PART).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" name="reason">
              <Textarea id="reason" name="reason" rows={2} placeholder="Family function / fever / exam duty at another college" />
            </Field>
            <p className="text-xs text-slate-500">Decided by {decider}.</p>
            <SubmitButton>Apply</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="My leave">
          {mine.length === 0 ? (
            <Empty>You haven&apos;t applied for leave yet.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Dates</Th>
                  <Th>Type</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      {formatLeaveDates(r, formatDateShort)}
                      <div className="text-xs text-slate-500">{days(r)}</div>
                    </Td>
                    <Td>{STAFF_LEAVE_TYPE[r.type]}</Td>
                    <Td className="max-w-64 whitespace-normal text-slate-600">{r.reason}</Td>
                    <Td>
                      {STATUS_BADGE[r.status]}
                      <Decision r={r} />
                    </Td>
                    <Td>
                      {canCancelStaffLeave(r, today) && (
                        <ActionForm action={cancelStaffLeave} confirm="Cancel this leave?">
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Cancel
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {scope !== "OWN" && (
        <Card title={scope === "ALL" ? "All staff leave" : "Leave in your department"} className="mt-6">
          {others.length === 0 ? (
            <Empty>No leave applications yet.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Staff</Th>
                  <Th>Dates</Th>
                  <Th>Type</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {others.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      {r.name}
                      <div className="text-xs text-slate-500">
                        {r.dept ?? "No department"}
                        {r.isHod ? " · HOD" : ""}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatLeaveDates(r, formatDateShort)}
                      <div className="text-xs text-slate-500">{days(r)}</div>
                    </Td>
                    <Td>{STAFF_LEAVE_TYPE[r.type]}</Td>
                    <Td className="max-w-64 whitespace-normal text-slate-600">{r.reason}</Td>
                    <Td>
                      {STATUS_BADGE[r.status]}
                      <Decision r={r} />
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

const days = (r: LeaveRow) => {
  const n = leaveDayCount(r);
  return `${n} day${n === 1 ? "" : "s"}`;
};

function Decision({ r }: { r: LeaveRow }) {
  if (!r.decidedBy) return null;
  return (
    <div className="max-w-56 whitespace-normal text-xs text-slate-500">
      by {r.decidedBy}
      {r.decisionNote ? `: ${r.decisionNote}` : ""}
    </div>
  );
}

function LeaveSummary({ r }: { r: LeaveRow }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p className="font-medium text-slate-900">
          {r.name}{" "}
          <span className="text-xs font-normal text-slate-500">
            {[r.designation, r.dept, r.isHod ? "HOD" : null].filter(Boolean).join(" · ")}
          </span>
        </p>
        <p className="text-sm text-slate-700">
          {STAFF_LEAVE_TYPE[r.type]} · {formatLeaveDates(r, formatDateShort)} ({days(r)})
        </p>
        <p className="text-sm text-slate-500">{r.reason}</p>
      </div>
      <p className="text-xs text-slate-500">Applied {formatDateShort(r.appliedOn)}</p>
    </div>
  );
}

function ClassesList({ classes, open = false }: { classes: MissedClass[]; open?: boolean }) {
  if (classes.length === 0) return <p className="mt-1 text-xs text-slate-500">No timetable classes on these days.</p>;
  return (
    <details className="mt-2 text-sm" open={open}>
      <summary className="cursor-pointer text-amber-800">
        {classes.length} class{classes.length === 1 ? "" : "es"} on these days need a substitute
      </summary>
      <ul className="mt-1 space-y-0.5 text-slate-700">
        {classes.map((c, i) => (
          <li key={i} className="tabular-nums">
            {formatDateShort(c.date)} · {c.startsAt} ({c.periods}) · {c.className} · {c.subject} {c.component === "PRACTICAL" ? "lab" : "theory"}
            {c.batch !== "ALL" ? ` (${c.batch})` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
