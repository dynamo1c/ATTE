import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Input, NoAccess, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { canApproveForClass, canRecordLeave, classTeacherClassIds, seesWholeCollege, visibleDepartmentIds } from "@/lib/auth/permissions";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses } from "@/server/queries";
import { createLeave, decideLeave, withdrawLeave } from "./actions";

export const metadata = { title: "Leave & OD · MEI Attendance" };

const TYPE = { MEDICAL: "Medical", ON_DUTY: "On duty (OD)", PERSONAL: "Personal", OTHER: "Other" } as const;

export default async function LeavesPage(props: PageProps<"/leaves">) {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="leave notices (no term set up)" />;
  const sp = await props.searchParams;
  const show = sp.show === "all" ? "all" : "pending";

  const all = await listClasses(term.id);
  const depts = visibleDepartmentIds(me.actor);
  const own = new Set([...classTeacherClassIds(me.actor), ...me.actor.teachingClassIds]);
  const classes = seesWholeCollege(me.actor) ? all : all.filter((c) => depts?.includes(c.departmentId) || own.has(c.id));
  if (classes.length === 0) return <NoAccess what="leave notices" />;
  const canRecord = classes.some((c) => canRecordLeave(me.actor, c));
  const classById = new Map(classes.map((c) => [c.id, c]));

  const { rows } = await getDb().execute<{
    id: number;
    type: keyof typeof TYPE;
    from_date: string;
    to_date: string;
    reason: string | null;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reg_no: string;
    name: string;
    student_id: number;
    class_id: number;
    created_by: string;
    created_by_id: number;
    approved_by: string | null;
  }>(sql`
    SELECT ln.id, ln.type, to_char(ln.from_date, 'YYYY-MM-DD') AS from_date, to_char(ln.to_date, 'YYYY-MM-DD') AS to_date, ln.reason, ln.status,
           s.reg_no, s.name, s.id AS student_id, m.class_group_id AS class_id, cb.name AS created_by, cb.id AS created_by_id, ab.name AS approved_by
    FROM leave_notice ln
    JOIN student s ON s.id = ln.student_id
    JOIN class_membership m ON m.student_id = s.id AND m.term_id = ${term.id}
    JOIN staff cb ON cb.id = ln.created_by
    LEFT JOIN staff ab ON ab.id = ln.approved_by
    WHERE m.class_group_id IN (${sql.join(classes.map((c) => sql`${c.id}`), sql`, `)})
      ${show === "pending" ? sql`AND ln.status = 'PENDING'` : sql``}
    ORDER BY (ln.status = 'PENDING') DESC, ln.from_date DESC
    LIMIT 300`);

  return (
    <>
      <PageHeader title="Leave & on-duty" subtitle="Students marked absent on these days are counted using the leave rules in Settings (e.g. on-duty counts as present)." />

      {canRecord && (
        <Card title="Record a notice" className="mb-6 max-w-4xl">
          <ActionForm action={createLeave} resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Register number" name="regNo">
                <Input id="regNo" name="regNo" placeholder="204CS25012" className="font-mono uppercase" autoComplete="off" />
              </Field>
              <Field label="Type" name="type">
                <Select id="type" name="type">
                  {Object.entries(TYPE).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From" name="fromDate">
                <Input id="fromDate" name="fromDate" type="date" defaultValue={todayIn()} />
              </Field>
              <Field label="To" name="toDate">
                <Input id="toDate" name="toDate" type="date" defaultValue={todayIn()} />
              </Field>
            </div>
            <Field label="Reason" name="reason">
              <Textarea id="reason" name="reason" rows={2} placeholder="Inter-polytechnic sports meet / fever, certificate submitted" />
            </Field>
            <SubmitButton>Record</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <Card
        title={show === "pending" ? "Waiting for approval" : "All notices this term"}
        actions={
          <Link href={show === "pending" ? "/leaves?show=all" : "/leaves"} className="text-sm text-blue-700 hover:underline">
            {show === "pending" ? "Show all" : "Show pending only"}
          </Link>
        }
      >
        {rows.length === 0 ? (
          <Empty>{show === "pending" ? "Nothing waiting." : "No notices yet."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Class</Th>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = classById.get(r.class_id)!;
                const approver = canApproveForClass(me.actor, c);
                const canWithdraw = approver || (r.created_by_id === me.id && r.status === "PENDING");
                return (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/students/${r.student_id}`} className="text-blue-700 hover:underline">
                        {r.name}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">{r.reg_no}</div>
                    </Td>
                    <Td>
                      {c.departmentCode} Sem {c.semester}
                    </Td>
                    <Td>{TYPE[r.type]}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDateShort(r.from_date)}
                      {r.to_date !== r.from_date && ` – ${formatDateShort(r.to_date)}`}
                    </Td>
                    <Td className="max-w-64 text-slate-600">{r.reason}</Td>
                    <Td>
                      {r.status === "PENDING" ? <Badge tone="amber">Pending</Badge> : r.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="red">Rejected</Badge>}
                      <div className="text-xs text-slate-500">by {r.approved_by ?? r.created_by}</div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {approver && r.status === "PENDING" && (
                          <>
                            <ActionForm action={decideLeave}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="decision" value="APPROVED" />
                              <SubmitButton size="sm">Approve</SubmitButton>
                            </ActionForm>
                            <ActionForm action={decideLeave} confirm="Reject this notice?">
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="decision" value="REJECTED" />
                              <SubmitButton size="sm" variant="danger">
                                Reject
                              </SubmitButton>
                            </ActionForm>
                          </>
                        )}
                        {canWithdraw && (
                          <ActionForm action={withdrawLeave} confirm="Remove this notice? Attendance % will no longer apply it.">
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton size="sm" variant="ghost">
                              Remove
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
