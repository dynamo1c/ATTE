import Link from "next/link";
import { ReportActions } from "@/components/report-actions";
import { Badge, Card, Empty, NoAccess, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { canViewCompliance } from "@/lib/auth/permissions";
import { formatDateShort } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listVisibleClasses } from "@/server/queries";
import { loadUnentered, UNENTERED_LIMIT, type UnenteredRow } from "@/server/report-data";
import { ReportTabs } from "../tabs";

export const metadata = { title: "Not yet entered · MEI Attendance" };

export default async function ComplianceReport() {
  const me = await requireStaff();
  if (!canViewCompliance(me.actor)) return <NoAccess what="this report" />;
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="reports (no term set up)" />;
  const classes = await listVisibleClasses(me.actor, term.id);
  if (classes.length === 0) return <NoAccess what="this report" />;
  const { rows, today } = await loadUnentered(me.actor, classes);

  // One session can have two teachers (e.g. shared lab); it appears under each, but the totals count it once.
  const byTeacher = new Map<string, { id: number | null; name: string; dept: string | null; overdue: UnenteredRow[]; today: UnenteredRow[] }>();
  const overdueIds = new Set<number>();
  const todayIds = new Set<number>();
  for (const r of rows) {
    const key = r.staff_id === null ? "none" : String(r.staff_id);
    let t = byTeacher.get(key);
    if (!t) byTeacher.set(key, (t = { id: r.staff_id, name: r.staff_name ?? "No teacher assigned", dept: r.staff_dept, overdue: [], today: [] }));
    if (r.date < today) {
      t.overdue.push(r);
      overdueIds.add(r.session_id);
    } else {
      t.today.push(r);
      todayIds.add(r.session_id);
    }
  }
  const teachers = [...byTeacher.values()].sort((a, b) => b.overdue.length - a.overdue.length || b.today.length - a.today.length || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Classes whose attendance has not been entered. They are left out of every percentage until entered, so parents and shortage lists depend on this being empty."
        actions={<ReportActions excel="/exports/unentered" print={false} />}
      />
      <ReportTabs active="compliance" showCompliance />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overdue (before today)" value={overdueIds.size} />
        <Stat label="Today, not yet entered" value={todayIds.size} hint="May still be in progress" />
        <Stat label="Teachers with overdue classes" value={teachers.filter((t) => t.overdue.length > 0).length} />
      </dl>
      {rows.length === UNENTERED_LIMIT && <p className="mb-4 text-sm text-amber-800">Showing the oldest {UNENTERED_LIMIT} only.</p>}

      <Card title="By teacher">
        {teachers.length === 0 ? (
          <Empty>Every class is entered. ✓</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Teacher</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Today</Th>
                <Th>Oldest</Th>
                <Th>Classes</Th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const list = [...t.overdue, ...t.today];
                return (
                  <tr key={t.id ?? "none"}>
                    <Td>
                      {t.id ? (
                        <Link href={`/staff/${t.id}`} className="text-blue-700 hover:underline">
                          {t.name}
                        </Link>
                      ) : (
                        <Badge tone="red">{t.name}</Badge>
                      )}
                      {t.dept && <div className="text-xs text-slate-500">{t.dept}</div>}
                    </Td>
                    <Td className={`text-right tabular-nums ${t.overdue.length ? "font-semibold text-red-800" : "text-slate-400"}`}>{t.overdue.length}</Td>
                    <Td className="text-right tabular-nums">{t.today.length}</Td>
                    <Td className="whitespace-nowrap">{list[0].date === today ? "Today" : formatDateShort(list[0].date)}</Td>
                    <Td>
                      <details>
                        <summary className="cursor-pointer text-sm text-blue-700">Show {list.length}</summary>
                        <ul className="mt-2 space-y-1 text-sm">
                          {list.slice(0, 60).map((r) => (
                            <li key={r.session_id}>
                              <Link href={`/attendance/${r.session_id}`} className="hover:underline">
                                <span className="text-slate-500">{r.date === today ? "Today" : formatDateShort(r.date)} {r.starts_at}</span> · {r.class_name} · {r.subject}
                                {r.component === "PRACTICAL" && " lab"}
                                {r.batch_scope !== "ALL" && ` ${r.batch_scope}`}
                              </Link>
                            </li>
                          ))}
                          {list.length > 60 && <li className="text-slate-500">…and {list.length - 60} more</li>}
                        </ul>
                      </details>
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
