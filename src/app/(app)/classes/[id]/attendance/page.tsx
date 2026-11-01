import Link from "next/link";
import { notFound } from "next/navigation";
import { Pct, StandingBadge } from "@/components/attendance";
import { ExcelLink, PrintButton } from "@/components/report-actions";
import { Card, Empty, Input, NoAccess, PageHeader, Select, Stat, Table, Td, Th, buttonClass } from "@/components/ui";
import { canViewClass } from "@/lib/auth/permissions";
import { formatPercent, mergeTallies, percent, tallyStanding } from "@/lib/domain/attendance";
import { formatDateShort, isIsoDate, todayIn } from "@/lib/domain/dates";
import { monthsBetween } from "@/lib/domain/register";
import { getClassAttendance, isCurrent } from "@/server/attendance-report";
import { requireStaff } from "@/server/current";
import { getClass, getCurrentTerm, parseId } from "@/server/queries";

export const metadata = { title: "Class attendance · MEI Attendance" };

export default async function ClassAttendancePage(props: PageProps<"/classes/[id]/attendance">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  const cls = id ? await getClass(id) : null;
  if (!cls) notFound();
  if (!canViewClass(me.actor, cls)) return <NoAccess what="this class" />;
  const sp = await props.searchParams;
  const term = await getCurrentTerm();
  let fromRaw = isIsoDate(sp.from) ? sp.from : null;
  let toRaw = isIsoDate(sp.to) ? sp.to : null;
  if (fromRaw && toRaw && fromRaw > toRaw) [fromRaw, toRaw] = [toRaw, fromRaw];
  const show = sp.show === "risk" ? "risk" : "all";

  const data = await getClassAttendance(cls.id, { from: fromRaw, to: toRaw });
  const current = data.students.filter(isCurrent);
  const shortage = current.filter((s) => s.standing === "SHORTAGE").length;
  const atRisk = current.filter((s) => s.standing === "AT_RISK").length;
  const classTally = mergeTallies(...current.map((s) => s.attendance.overall));
  // Former students stay visible (their marks are real) but at the bottom, greyed.
  const rows = [...current, ...data.students.filter((s) => !isCurrent(s))].filter((s) => show === "all" || s.standing === "SHORTAGE" || s.standing === "AT_RISK");
  const title = `${cls.departmentCode} Sem ${cls.semester}`;
  const rangeLabel = fromRaw || toRaw ? `${fromRaw ? formatDateShort(fromRaw) : "Term start"} – ${formatDateShort(data.to)}` : `Whole term to ${formatDateShort(data.to)}`;
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { from: fromRaw, to: toRaw, show: show === "risk" ? "risk" : null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <PageHeader
        title={`${title} · Attendance`}
        subtitle={`${rangeLabel} · Minimum ${data.minPct}% per subject, at risk below ${data.warnPct}%`}
        back={{ href: `/classes/${cls.id}`, label: title }}
        actions={
          <>
            <ExcelLink href={`/exports/class-attendance?${new URLSearchParams({ class: String(cls.id), ...(fromRaw ? { from: fromRaw } : {}), ...(toRaw ? { to: toRaw } : {}) })}`} label="Excel + eligibility" />
            {term && (
              <form action="/exports/register" method="get" className="no-print flex gap-1">
                <input type="hidden" name="class" value={cls.id} />
                <Select name="month" aria-label="Register month" className="h-8 w-auto py-1">
                  {monthsBetween(term.startsOn, todayIn()).map((m) => (
                    <option key={m} value={m}>
                      {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "numeric" })}
                    </option>
                  ))}
                </Select>
                <button className={`whitespace-nowrap ${buttonClass("secondary", "sm")}`}>Register (Excel)</button>
              </form>
            )}
            <PrintButton />
          </>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Class attendance" value={formatPercent(percent(classTally))} hint={`${classTally.attended.toLocaleString("en-IN")} of ${classTally.counted.toLocaleString("en-IN")} student-classes`} />
        <Stat label={`Below ${data.minPct}% (any subject)`} value={shortage} hint={`of ${current.length} students`} />
        <Stat label={`At risk (below ${data.warnPct}%)`} value={atRisk} />
        <Stat
          label="Classes not yet entered"
          value={data.unmarkedSessions}
          hint={data.unmarkedSessions ? "Left out of the % until entered" : `${data.heldSessions} classes counted`}
        />
      </dl>

      <Card
        title={show === "risk" ? "Students below or near the minimum" : "All students"}
        actions={
          <form className="no-print flex flex-wrap items-end gap-2" action="">
            {show === "risk" && <input type="hidden" name="show" value="risk" />}
            <label className="text-xs text-slate-500">
              From
              <Input type="date" name="from" defaultValue={fromRaw ?? ""} min={term?.startsOn} className="h-8 py-1" />
            </label>
            <label className="text-xs text-slate-500">
              To
              <Input type="date" name="to" defaultValue={toRaw ?? ""} className="h-8 py-1" />
            </label>
            <button className={buttonClass("secondary", "sm")}>Apply</button>
            {(fromRaw || toRaw) && (
              <Link href={qs({ from: null, to: null })} className="text-sm text-blue-700 hover:underline">
                Whole term
              </Link>
            )}
            <Link href={qs({ show: show === "risk" ? null : "risk" })} className="text-sm text-blue-700 hover:underline">
              {show === "risk" ? "Show everyone" : "Only shortage / at risk"}
            </Link>
          </form>
        }
      >
        {rows.length === 0 ? (
          <Empty>{show === "risk" ? "Nobody is below the warning level." : "No students in this class."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Roll</Th>
                <Th>Student</Th>
                {data.subjects.map((s) => (
                  <Th key={s.offeringId} className="text-right">
                    <span title={s.name}>{s.shortName}</span>
                  </Th>
                ))}
                <Th className="text-right">Overall</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const by = new Map(s.attendance.byOffering.map((o) => [o.offeringId, o]));
                const gone = !isCurrent(s);
                return (
                  <tr key={s.studentId} className={gone ? "opacity-50" : undefined}>
                    <Td className="tabular-nums">{s.roll}</Td>
                    <Td>
                      <Link href={`/students/${s.studentId}`} className="text-blue-700 hover:underline">
                        {s.name}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">{s.regNo}</div>
                    </Td>
                    {data.subjects.map((sub) => {
                      const o = by.get(sub.offeringId);
                      return (
                        <Td key={sub.offeringId} className="text-right">
                          {o ? <Pct tally={o.total} standing={s.subjectStanding.get(sub.offeringId)!} compact /> : <span className="text-slate-300">—</span>}
                        </Td>
                      );
                    })}
                    <Td className="text-right">
                      <Pct tally={s.attendance.overall} standing={tallyStanding(s.attendance.overall, data.minPct, data.warnPct)} compact />
                    </Td>
                    <Td>
                      {gone ? <span className="text-xs text-slate-500">{s.leftOn ? `Left ${formatDateShort(s.leftOn)}` : s.status.toLowerCase()}</span> : <StandingBadge standing={s.standing} minPct={data.minPct} />}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Each class counts once, however many periods (a 3-hour lab = 1). Late counts as present. Leave and on-duty follow the rules in Settings. Hover a number for details.
        </p>
      </Card>
    </>
  );
}
