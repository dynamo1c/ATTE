import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { Pct, StandingBadge } from "@/components/attendance";
import { Badge, Card, Empty, Table, Td, Th } from "@/components/ui";
import { classesCanMiss, classesToReach, emptyTally, tallyStanding } from "@/lib/domain/attendance";
import { formatDateShort } from "@/lib/domain/dates";
import { getClassAttendance, getLeavePolicy } from "@/server/attendance-report";

const LEAVE_LABEL = { MEDICAL: "Medical", ON_DUTY: "OD", PERSONAL: "Personal", OTHER: "Leave" } as const;

/** Attendance % per subject for one student in their current class, plus their recent absences. Also used by the parent portal. */
export async function StudentAttendanceCard({ studentId, classId, forParent = false }: { studentId: number; classId: number; forParent?: boolean }) {
  const [data, policy, recent] = await Promise.all([
    getClassAttendance(classId, { studentIds: [studentId] }),
    getLeavePolicy(),
    getDb().execute<{ date: string; status: "ABSENT" | "LATE"; subject: string; component: string; leave: keyof typeof LEAVE_LABEL | null }>(sql`
      SELECT to_char(cs.date, 'YYYY-MM-DD') AS date, ar.status::text, c.short_name AS subject, cs.component::text,
             (SELECT ln.type::text FROM leave_notice ln WHERE ln.student_id = ar.student_id AND ln.status = 'APPROVED'
                AND cs.date BETWEEN ln.from_date AND ln.to_date LIMIT 1) AS leave
      FROM attendance_record ar
      JOIN class_session cs ON cs.id = ar.session_id
      JOIN course_offering o ON o.id = cs.offering_id
      JOIN course c ON c.id = o.course_id
      WHERE ar.student_id = ${studentId} AND o.class_group_id = ${classId} AND cs.status = 'HELD' AND ar.status <> 'PRESENT'
      ORDER BY cs.date DESC, cs.start_period DESC
      LIMIT 15`),
  ]);
  const me = data.students[0];
  if (!me) return null;
  const { minPct, warnPct } = data;
  const by = new Map(me.attendance.byOffering.map((o) => [o.offeringId, o]));
  const overall = me.attendance.overall;
  // The standing is per subject (60% rule), so say how many subjects: "61% overall · Below 60%" alone reads as a contradiction.
  const short = [...me.subjectStanding.values()].filter((s) => s === "SHORTAGE").length;
  const risky = [...me.subjectStanding.values()].filter((s) => s === "AT_RISK").length;

  return (
    <Card
      title="Attendance this term"
      className="mb-6"
      actions={
        !forParent && (
        <Link href={`/classes/${classId}/attendance`} className="text-sm text-blue-700 hover:underline">
          Whole class →
        </Link>
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold">
          <Pct tally={overall} standing={tallyStanding(overall, minPct, warnPct)} compact />
        </span>
        <span className="text-sm text-slate-600">
          overall · {overall.attended} of {overall.counted} classes
          {overall.late > 0 && ` · ${overall.late} late`}
        </span>
        {short > 0 ? (
          <Badge tone="red">
            Below {minPct}% in {short} subject{short === 1 ? "" : "s"}
          </Badge>
        ) : risky > 0 ? (
          <Badge tone="amber">
            At risk in {risky} subject{risky === 1 ? "" : "s"}
          </Badge>
        ) : (
          <StandingBadge standing={me.standing} minPct={minPct} />
        )}
        {overall.unmarked > 0 && <span className="text-xs text-amber-700">{overall.unmarked} classes not yet entered by teachers</span>}
      </div>

      {data.subjects.length === 0 ? (
        <Empty>No subjects in this class yet.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Subject</Th>
              <Th className="text-right">Theory</Th>
              <Th className="text-right">Lab</Th>
              <Th className="text-right">Total</Th>
              <Th>To stay at {minPct}%</Th>
            </tr>
          </thead>
          <tbody>
            {data.subjects.map((sub) => {
              const o = by.get(sub.offeringId);
              const total = o?.total ?? emptyTally();
              const st = me.subjectStanding.get(sub.offeringId) ?? "NO_DATA";
              const need = classesToReach(total, minPct);
              const miss = classesCanMiss(total, minPct);
              return (
                <tr key={sub.offeringId}>
                  <Td>
                    <span title={sub.name}>{sub.shortName}</span>
                    <div className="text-xs text-slate-500">{sub.code}</div>
                  </Td>
                  <Td className="text-right">{sub.hasTheory && o ? <Pct tally={o.theory} standing={tallyStanding(o.theory, minPct, warnPct)} /> : <span className="text-slate-300">—</span>}</Td>
                  <Td className="text-right">{sub.hasPractical && o ? <Pct tally={o.practical} standing={tallyStanding(o.practical, minPct, warnPct)} /> : <span className="text-slate-300">—</span>}</Td>
                  <Td className="text-right">
                    <Pct tally={total} standing={st} />
                  </Td>
                  <Td className="text-sm">
                    {total.counted === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : st === "SHORTAGE" ? (
                      <span className="text-red-800">{need === null ? "Cannot reach" : `Must attend the next ${need} in a row`}</span>
                    ) : (
                      <span className="text-slate-600">{miss === null ? "No minimum" : miss === 0 ? "Cannot miss the next class" : `Can miss ${miss} more`}</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">Recent absences and late arrivals</h3>
      {recent.rows.length === 0 ? (
        <p className="text-sm text-slate-500">None.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {recent.rows.map((r, i) => (
            <li key={i} className="rounded border border-slate-200 px-2 py-1 text-xs">
              <span className="text-slate-500">{formatDateShort(r.date)}</span> {r.subject}
              {r.component === "PRACTICAL" && " lab"}{" "}
              {r.status === "LATE" ? (
                <Badge tone="amber">Late</Badge>
              ) : r.leave ? (
                <Badge tone={policy[r.leave] === "PRESENT" ? "green" : "blue"}>{LEAVE_LABEL[r.leave]}</Badge>
              ) : (
                <Badge tone="red">Absent</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
