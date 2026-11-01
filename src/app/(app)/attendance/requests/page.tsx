import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Input, PageHeader } from "@/components/ui";
import { hodDepartmentIds, isAdmin } from "@/lib/auth/permissions";
import { formatDateShort } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { decideEditRequest } from "../actions";

export const metadata = { title: "Attendance change requests · MEI Attendance" };

type Change = { studentId: number; from: string | null; to: string };
const WORD: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LATE: "Late" };

export default async function RequestsPage() {
  const me = await requireStaff();
  const depts = hodDepartmentIds(me.actor);
  const approver = isAdmin(me.actor) || depts.length > 0;
  const scope = isAdmin(me.actor)
    ? sql`true`
    : depts.length
      ? sql`(cg.department_id IN (${sql.join(depts.map((d) => sql`${d}`), sql`, `)}) OR r.requested_by = ${me.id})`
      : sql`r.requested_by = ${me.id}`;

  const { rows } = await getDb().execute<{
    id: number;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reason: string;
    changes: Change[];
    created: string;
    requested_by: string;
    decided_by: string | null;
    decision_note: string | null;
    session_id: number;
    date: string;
    subject: string;
    class_name: string;
    department_id: number;
    names: Record<string, string> | null;
  }>(sql`
    SELECT r.id, r.status, r.reason, r.changes, to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI') AS created,
           rs.name AS requested_by, ds.name AS decided_by, r.decision_note,
           cs.id AS session_id, to_char(cs.date, 'YYYY-MM-DD') AS date, c.short_name || CASE WHEN cs.component = 'PRACTICAL' THEN ' Lab' ELSE '' END AS subject,
           d.code || ' Sem ' || cg.semester AS class_name, cg.department_id,
           (SELECT json_object_agg(st.id, st.reg_no || ' ' || st.name) FROM student st
             WHERE st.id IN (SELECT (x->>'studentId')::int FROM jsonb_array_elements(r.changes) x)) AS names
    FROM attendance_edit_request r
    JOIN staff rs ON rs.id = r.requested_by
    LEFT JOIN staff ds ON ds.id = r.decided_by
    JOIN class_session cs ON cs.id = r.session_id
    JOIN course_offering o ON o.id = cs.offering_id JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id JOIN department d ON d.id = cg.department_id
    WHERE ${scope}
    ORDER BY (r.status = 'PENDING') DESC, r.created_at DESC
    LIMIT 100`);

  return (
    <>
      <PageHeader
        title="Attendance change requests"
        subtitle={approver ? "Changes teachers asked for after the edit window closed. Approving applies them." : "Your requests to change attendance after the edit window."}
        back={{ href: "/attendance", label: "Attendance" }}
      />
      {rows.length === 0 ? (
        <Card>
          <Empty>No requests.</Empty>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const canDecide = r.status === "PENDING" && (isAdmin(me.actor) || depts.includes(r.department_id));
            return (
              <Card
                key={r.id}
                title={
                  <Link href={`/attendance/${r.session_id}`} className="hover:underline">
                    {r.subject} · {r.class_name} · {formatDateShort(r.date)}
                  </Link>
                }
                actions={r.status === "PENDING" ? <Badge tone="amber">Waiting</Badge> : r.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="red">Rejected</Badge>}
              >
                <p className="text-sm text-slate-700">
                  <b>{r.requested_by}</b> on {r.created}: “{r.reason}”
                </p>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {r.changes.map((c) => (
                    <li key={c.studentId}>
                      <span className="font-mono text-xs">{r.names?.[c.studentId] ?? `Student #${c.studentId}`}</span>: {c.from ? WORD[c.from] : "not marked"} → <b>{WORD[c.to]}</b>
                    </li>
                  ))}
                </ul>
                {r.decided_by && (
                  <p className="mt-2 text-xs text-slate-500">
                    Decided by {r.decided_by}
                    {r.decision_note && `: “${r.decision_note}”`}
                  </p>
                )}
                {canDecide && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                    <ActionForm action={decideEditRequest} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="APPROVED" />
                      <Input name="note" placeholder="Note (optional)" className="w-56" />
                      <SubmitButton size="sm">Approve</SubmitButton>
                    </ActionForm>
                    <ActionForm action={decideEditRequest} confirm="Reject this request?">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="REJECTED" />
                      <SubmitButton size="sm" variant="danger">
                        Reject
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
