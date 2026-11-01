import Link from "next/link";
import { Card, Empty, NoAccess, PageHeader, Select, Stat, Table, Td, Th, buttonClass } from "@/components/ui";
import { canViewCompliance } from "@/lib/auth/permissions";
import { formatMark } from "@/lib/domain/marks";
import { requireStaff } from "@/server/current";
import { getClassMarks } from "@/server/marks-data";
import { getCurrentTerm, getSettings, listVisibleClasses, mapLimit } from "@/server/queries";
import { ReportTabs } from "../tabs";

export const metadata = { title: "Low marks · MEI Attendance" };

export default async function LowMarksReport(props: PageProps<"/reports/marks">) {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="reports (no term set up)" />;
  const visible = await listVisibleClasses(me.actor, term.id);
  if (visible.length === 0) return <NoAccess what="reports" />;
  const sp = await props.searchParams;
  const depts = [...new Map(visible.map((c) => [c.departmentId, c.departmentCode])).entries()];
  const deptId = typeof sp.dept === "string" && depts.some(([id]) => String(id) === sp.dept) ? Number(sp.dept) : null;
  const classes = visible.filter((c) => deptId === null || c.departmentId === deptId);
  const settings = await getSettings();
  const low = settings.lowMarksPct;

  const results = await mapLimit(classes, 4, (c) => getClassMarks(c.id));
  const rows = results.flatMap((data, i) =>
    data.students
      .filter((s) => s.current)
      .map((s) => {
        const weak = data.subjects.flatMap((sub) => {
          const r = s.subjects.get(sub.offeringId)!.result;
          const v = r.cie.scaled ?? r.cie.scaledSoFar;
          return v !== null && v * 100 < low * r.cieOutOf ? [{ subject: sub.subject, value: v, outOf: r.cieOutOf, final: r.cie.scaled !== null, parts: `${r.cie.entered}/${r.cie.parts}` }] : [];
        });
        return { cls: classes[i], s, weak, worst: Math.min(...weak.map((w) => (w.value / w.outOf) * 100)) };
      })
      .filter((r) => r.weak.length > 0),
  );
  rows.sort((a, b) => a.cls.departmentCode.localeCompare(b.cls.departmentCode) || a.cls.semester - b.cls.semester || a.worst - b.worst);
  const studentCount = results.reduce((n, d) => n + d.students.filter((s) => s.current).length, 0);

  return (
    <>
      <PageHeader title="Reports" subtitle={`Internal marks (CIE) below ${low}% in a subject — from the tests entered so far, including drafts.`} />
      <ReportTabs active="marks" showCompliance={canViewCompliance(me.actor)} />
      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Students below ${low}% in a subject`} value={rows.length} hint={`of ${studentCount.toLocaleString("en-IN")} in ${classes.length} classes`} />
      </dl>
      <Card
        title="Low internal marks"
        actions={
          depts.length > 1 && (
            <form className="flex items-end gap-2" action="">
              <Select name="dept" defaultValue={deptId ?? ""} className="h-8 w-auto py-1" aria-label="Department">
                <option value="">All departments</option>
                {depts.map(([id, code]) => (
                  <option key={id} value={id}>
                    {code}
                  </option>
                ))}
              </Select>
              <button className={buttonClass("secondary", "sm")}>Show</button>
            </form>
          )
        }
      >
        {rows.length === 0 ? (
          <Empty>Nobody below {low}%. ✓</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Student</Th>
                <Th>Subjects (internal so far)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cls, s, weak }) => (
                <tr key={s.studentId}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/classes/${cls.id}/marks`} className="text-blue-700 hover:underline">
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
                        <span key={w.subject} className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-800" title={`${w.parts} tests entered${w.final ? "" : " (so far)"}`}>
                          {w.subject} {formatMark(w.value)}/{w.outOf}
                          {!w.final && "*"}
                        </span>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">* so far: not every test is in yet. The low level is set in Settings.</p>
      </Card>
    </>
  );
}
