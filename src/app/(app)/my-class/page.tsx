import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, NoAccess, PageHeader, Select, Stat, Table, Td, Th, buttonClass } from "@/components/ui";
import { canViewClassStatus, classTeacherClassIds } from "@/lib/auth/permissions";
import { percent } from "@/lib/domain/attendance";
import { formatDateShort, todayIn, weekStart } from "@/lib/domain/dates";
import { getClassAttendance } from "@/server/attendance-report";
import { attendanceEntry, marksEntry, type MarksEntryRow } from "@/server/class-status";
import { requireStaff } from "@/server/current";
import { departmentDay } from "@/server/department-day";
import { generateSessions } from "@/server/generate-sessions";
import { getCurrentTerm, listClasses } from "@/server/queries";

export const metadata = { title: "My class · MEI Attendance" };

const MARKS_STATUS: Record<NonNullable<MarksEntryRow["status"]>, { label: string; tone: "slate" | "amber" | "blue" | "green" }> = {
  DRAFT: { label: "Being entered", tone: "amber" },
  SUBMITTED: { label: "With the HOD", tone: "blue" },
  PUBLISHED: { label: "Published", tone: "green" },
};

/**
 * The class teacher's view of their class: today's periods and who took them, classes not yet entered this
 * week per teacher, how far each test's marks are, and who is short of attendance. Read-only.
 */
export default async function MyClassPage(props: PageProps<"/my-class">) {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="your class (no term set up)" />;
  const own = classTeacherClassIds(me.actor);
  const sp = await props.searchParams;
  const requested = typeof sp.class === "string" ? Number(sp.class) : own[0];
  const [c] = Number.isInteger(requested) ? await listClasses(term.id, { classIds: [requested] }) : [];
  if (!c || !canViewClassStatus(me.actor, { id: c.id, departmentId: c.departmentId })) return <NoAccess what="this class's status" />;
  const mine = own.length > 1 ? await listClasses(term.id, { classIds: own }) : [];

  const today = todayIn();
  const from = weekStart(today);
  await generateSessions(getDb(), { classIds: [c.id], until: today, reuse: true });
  const [periods, week, marks, att] = await Promise.all([
    departmentDay(term.id, today, [c.departmentId], me.id).then((rows) => rows.filter((r) => r.classId === c.id)),
    attendanceEntry(c.id, from, today),
    marksEntry(c.id),
    getClassAttendance(c.id),
  ]);

  const pendingWeek = week.reduce((n, r) => n + r.pending, 0);
  const short = att.students
    .filter((s) => s.leftOn === null && (s.standing === "SHORTAGE" || s.standing === "AT_RISK"))
    .map((s) => ({ ...s, pct: percent(s.attendance.overall) }))
    .sort((a, b) => (a.standing === b.standing ? (a.pct ?? 0) - (b.pct ?? 0) : a.standing === "SHORTAGE" ? -1 : 1));
  const shortCount = short.filter((s) => s.standing === "SHORTAGE").length;
  const marksBySubject = new Map<string, MarksEntryRow[]>();
  for (const m of marks) marksBySubject.set(m.subject, [...(marksBySubject.get(m.subject) ?? []), m]);
  const marksMissing = marks.filter((m) => !m.isFinal && m.status !== "PUBLISHED" && m.status !== "SUBMITTED" && m.entered < m.students).length;
  const nowHHMM = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <>
      <PageHeader
        title={`${c.departmentCode} Sem ${c.semester}`}
        subtitle={`${c.students} students${c.classTeacher ? ` · Class teacher: ${c.classTeacher}` : ""}`}
        actions={
          mine.length > 1 ? (
            <form method="get" className="flex gap-2">
              <Select name="class" defaultValue={c.id} aria-label="Class" className="w-auto">
                {mine.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.departmentCode} Sem {m.semester}
                  </option>
                ))}
              </Select>
              <button className={buttonClass("secondary")}>Show</button>
            </form>
          ) : undefined
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Not entered this week" value={pendingWeek} hint={pendingWeek ? "Classes with no attendance yet" : "Every class entered"} />
        <Stat label={`Below ${att.minPct}%`} value={shortCount} hint={`${short.length - shortCount} more at risk (below ${att.warnPct}%)`} />
        <Stat label="Tests with marks missing" value={marksMissing} />
        <Stat label="Students" value={c.students} />
      </dl>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Today">
          {periods.length === 0 ? (
            <Empty>No classes today.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {periods.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="tabular-nums text-slate-500">{p.startsAt}</span>{" "}
                    <span className="font-medium text-slate-900">
                      {p.subject}
                      {p.component === "PRACTICAL" && " Lab"}
                      {p.batchScope !== "ALL" && ` ${p.batchScope}`}
                    </span>{" "}
                    <span className="text-slate-500">· {p.teachers ?? "no teacher"}</span>
                  </span>
                  {p.status === "HELD" ? (
                    <Badge tone="green">
                      Saved by {p.savedBy} · {p.savedAt}
                    </Badge>
                  ) : p.status === "NOT_HELD" ? (
                    <Badge>Not held</Badge>
                  ) : p.status === "CANCELLED" ? (
                    <Badge>Cancelled</Badge>
                  ) : p.startsAt > nowHHMM ? (
                    <Badge tone="blue">Coming up</Badge>
                  ) : (
                    <Badge tone="amber">Not taken</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`This week (from ${formatDateShort(from)})`}>
          {week.length === 0 ? (
            <Empty>No classes this week yet.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Subject</Th>
                  <Th>Teacher</Th>
                  <Th className="text-right">Entered</Th>
                  <Th className="text-right">Not entered</Th>
                </tr>
              </thead>
              <tbody>
                {week.map((r) => (
                  <tr key={`${r.offeringId}-${r.component}`}>
                    <Td>
                      {r.subject}
                      {r.component === "PRACTICAL" && " Lab"}
                    </Td>
                    <Td className="text-slate-600">{r.teachers ?? "—"}</Td>
                    <Td className="text-right tabular-nums">
                      {r.held}
                      {r.notHeld > 0 && <span className="text-xs text-slate-400"> (+{r.notHeld} not held)</span>}
                    </Td>
                    <Td className="text-right">
                      {r.pending > 0 ? (
                        <span title={(r.pendingDates ?? []).map(formatDateShort).join(", ")}>
                          <Badge tone="amber">{r.pending}</Badge>
                          <span className="ml-1 text-xs text-slate-500">on {(r.pendingDates ?? []).map(formatDateShort).join(", ")}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-green-700">All in</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Marks entry">
          {marksBySubject.size === 0 ? (
            <Empty>No subjects set up.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...marksBySubject.entries()].map(([subject, tests]) => (
                <li key={subject} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <Link href={`/marks/${tests[0].offeringId}`} className="font-medium text-blue-700 hover:underline">
                      {subject}
                    </Link>
                    <span className="text-xs text-slate-500">{[...new Set(tests.map((t) => t.teachers).filter(Boolean))].join(" · ") || "no teacher"}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tests.map((t) => {
                      const s = t.status ? MARKS_STATUS[t.status] : null;
                      const partly = t.entered > 0 && t.entered < t.students;
                      return (
                        <Badge key={t.label} tone={s ? (partly && t.status === "DRAFT" ? "amber" : s.tone) : "slate"}>
                          {t.label}: {s ? (t.status === "DRAFT" ? `${t.entered}/${t.students} entered` : s.label) : "not started"}
                        </Badge>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Attendance shortage (below ${att.warnPct}%)`}
          actions={
            <Link href="/reports/attendance" className="text-sm text-blue-700 hover:underline">
              Full report
            </Link>
          }
        >
          {short.length === 0 ? (
            <Empty>Nobody below {att.warnPct}%.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th className="text-right">Overall</Th>
                  <Th>Standing</Th>
                </tr>
              </thead>
              <tbody>
                {short.slice(0, 40).map((s) => (
                  <tr key={s.studentId}>
                    <Td>
                      <Link href={`/students/${s.studentId}`} className="text-blue-700 hover:underline">
                        {s.name}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">{s.regNo}</div>
                    </Td>
                    <Td className="text-right tabular-nums">{s.pct === null ? "—" : `${s.pct.toFixed(1)}%`}</Td>
                    <Td>{s.standing === "SHORTAGE" ? <Badge tone="red">Below {att.minPct}% in a subject</Badge> : <Badge tone="amber">At risk</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
