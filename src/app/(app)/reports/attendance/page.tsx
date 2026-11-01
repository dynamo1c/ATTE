import Link from "next/link";
import { Pct, StandingBadge } from "@/components/attendance";
import { Card, Empty, NoAccess, PageHeader, Select, Stat, Table, Td, Th, buttonClass } from "@/components/ui";
import { canViewCompliance } from "@/lib/auth/permissions";
import { classesToReach, percent, tallyStanding } from "@/lib/domain/attendance";
import { formatDateShort } from "@/lib/domain/dates";
import { getClassAttendance, isCurrent } from "@/server/attendance-report";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listVisibleClasses, mapLimit } from "@/server/queries";
import { ReportTabs } from "../tabs";

export const metadata = { title: "Attendance shortage · MEI Attendance" };

export default async function ShortageReport(props: PageProps<"/reports/attendance">) {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="reports (no term set up)" />;
  const visible = await listVisibleClasses(me.actor, term.id);
  if (visible.length === 0) return <NoAccess what="attendance reports" />;

  const sp = await props.searchParams;
  const depts = [...new Map(visible.map((c) => [c.departmentId, c.departmentCode])).entries()];
  const deptId = typeof sp.dept === "string" && depts.some(([id]) => String(id) === sp.dept) ? Number(sp.dept) : null;
  const sems = [...new Set(visible.map((c) => c.semester))].sort();
  const sem = typeof sp.sem === "string" && sems.some((s) => String(s) === sp.sem) ? Number(sp.sem) : null;
  const level = sp.level === "risk" ? "risk" : "shortage";
  const classes = visible.filter((c) => (deptId === null || c.departmentId === deptId) && (sem === null || c.semester === sem));

  // Four classes at a time: a whole-college report must not starve the pool for teachers marking attendance.
  const results = await mapLimit(classes, 4, (c) => getClassAttendance(c.id));
  const minPct = results[0]?.minPct ?? 60;
  const warnPct = results[0]?.warnPct ?? 70;

  const rows = results.flatMap((data, i) => {
    const cls = classes[i];
    const subjects = new Map(data.subjects.map((s) => [s.offeringId, s]));
    return data.students
      .filter((s) => isCurrent(s) && (s.standing === "SHORTAGE" || (level === "risk" && s.standing === "AT_RISK")))
      .map((s) => {
        const weak = s.attendance.byOffering
          .filter((o) => s.subjectStanding.get(o.offeringId) === "SHORTAGE" || (level === "risk" && s.subjectStanding.get(o.offeringId) === "AT_RISK"))
          .map((o) => ({ o, subject: subjects.get(o.offeringId)!, standing: s.subjectStanding.get(o.offeringId)! }))
          .sort((a, b) => (percent(a.o.total) ?? 0) - (percent(b.o.total) ?? 0));
        const worstPct = Math.min(...weak.map((w) => percent(w.o.total) ?? 100));
        const need = Math.max(0, ...weak.filter((w) => w.standing === "SHORTAGE").map((w) => classesToReach(w.o.total, minPct) ?? 0));
        return { cls, s, weak, worstPct, need };
      });
  });
  rows.sort((a, b) => a.cls.departmentCode.localeCompare(b.cls.departmentCode) || a.cls.semester - b.cls.semester || a.worstPct - b.worstPct);
  const shortCount = rows.filter((r) => r.s.standing === "SHORTAGE").length;
  const studentsCovered = results.reduce((n, d) => n + d.students.filter(isCurrent).length, 0);
  const unmarked = results.reduce((n, d) => n + d.unmarkedSessions, 0);

  return (
    <>
      <PageHeader title="Reports" subtitle={`Up to ${formatDateShort(results[0]?.to ?? term.startsOn)} · rule: at least ${minPct}% in every subject`} />
      <ReportTabs active="attendance" showCompliance={canViewCompliance(me.actor)} />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Students below ${minPct}%`} value={shortCount} hint={`of ${studentsCovered.toLocaleString("en-IN")} in ${classes.length} classes`} />
        {level === "risk" && <Stat label={`At risk (${minPct}–${warnPct}%)`} value={rows.length - shortCount} />}
        <Stat label="Classes not yet entered" value={unmarked} hint={unmarked ? "Not in these numbers until entered" : undefined} />
      </dl>

      <Card
        title={level === "risk" ? `Below ${warnPct}% in a subject` : `Below ${minPct}% in a subject`}
        actions={
          <form className="flex flex-wrap items-end gap-2" action="">
            {depts.length > 1 && (
              <Select name="dept" defaultValue={deptId ?? ""} className="h-8 w-auto py-1" aria-label="Department">
                <option value="">All departments</option>
                {depts.map(([id, code]) => (
                  <option key={id} value={id}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
            {sems.length > 1 && (
              <Select name="sem" defaultValue={sem ?? ""} className="h-8 w-auto py-1" aria-label="Semester">
                <option value="">All semesters</option>
                {sems.map((s) => (
                  <option key={s} value={s}>
                    Sem {s}
                  </option>
                ))}
              </Select>
            )}
            <Select name="level" defaultValue={level} className="h-8 w-auto py-1" aria-label="Show">
              <option value="shortage">Shortage only</option>
              <option value="risk">Shortage + at risk</option>
            </Select>
            <button className={buttonClass("secondary", "sm")}>Show</button>
          </form>
        }
      >
        {rows.length === 0 ? (
          <Empty>Nobody here. ✓</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Student</Th>
                <Th>Subjects</Th>
                <Th className="text-right">Overall</Th>
                <Th>Needs</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cls, s, weak, need }) => (
                <tr key={s.studentId}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/classes/${cls.id}/attendance?show=risk`} className="text-blue-700 hover:underline">
                      {cls.departmentCode} Sem {cls.semester}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/students/${s.studentId}`} className="text-blue-700 hover:underline">
                      {s.name}
                    </Link>
                    <div className="font-mono text-xs text-slate-500">{s.regNo}</div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {weak.map((w) => (
                        <span key={w.o.offeringId} className="text-xs" title={w.subject.name}>
                          {w.subject.shortName} <Pct tally={w.o.total} standing={w.standing} compact />
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Pct tally={s.attendance.overall} standing={tallyStanding(s.attendance.overall, minPct, warnPct)} compact />
                  </Td>
                  <Td className="text-sm text-slate-600">{need > 0 ? `${need} classes in a row` : "—"}</Td>
                  <Td>
                    <StandingBadge standing={s.standing} minPct={minPct} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
