import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultCell, lowCie } from "@/components/marks";
import { Card, Empty, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { canViewClass } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { getClassMarks } from "@/server/marks-data";
import { getClass, getSettings, parseId } from "@/server/queries";

export const metadata = { title: "Class marks · MEI Attendance" };

export default async function ClassMarksPage(props: PageProps<"/classes/[id]/marks">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  const cls = id ? await getClass(id) : null;
  if (!cls) notFound();
  if (!canViewClass(me.actor, cls)) return <NoAccess what="this class" />;
  const [{ subjects, students }, settings] = await Promise.all([getClassMarks(cls.id), getSettings()]);
  const title = `${cls.departmentCode} Sem ${cls.semester}`;
  const rows = [...students.filter((s) => s.current), ...students.filter((s) => !s.current)];

  return (
    <>
      <PageHeader title={`${title} · Marks`} subtitle="Per subject: internal (CIE) and total. Open a subject for every test." back={{ href: `/classes/${cls.id}`, label: title }} />
      <Card>
        {rows.length === 0 || subjects.length === 0 ? (
          <Empty>No marks yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Roll</Th>
                <Th>Student</Th>
                {subjects.map((s) => (
                  <Th key={s.offeringId} className="text-center" colSpan={2}>
                    <Link href={`/marks/${s.offeringId}`} className="text-blue-700 hover:underline" title={s.subjectName}>
                      {s.subject}
                    </Link>
                  </Th>
                ))}
              </tr>
              <tr>
                <Th />
                <Th />
                {subjects.map((s) => (
                  <SubHeads key={s.offeringId} cieOutOf={s.formula.cieOutOf} total={s.formula.cieOutOf + (s.formula.seeOutOf !== null && s.parts.some((p) => p.isFinal) ? s.formula.seeOutOf : 0)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((st) => (
                <tr key={st.studentId} className={st.current ? undefined : "opacity-50"}>
                  <Td className="tabular-nums">{st.roll}</Td>
                  <Td>
                    <Link href={`/students/${st.studentId}`} className="text-blue-700 hover:underline">
                      {st.name}
                    </Link>
                    <div className="font-mono text-xs text-slate-500">{st.regNo}</div>
                  </Td>
                  {subjects.map((s) => {
                    const r = st.subjects.get(s.offeringId)!.result;
                    return (
                      <Cells key={s.offeringId}>
                        <ResultCell value={r.cie.scaled} soFar={r.cie.scaledSoFar} outOf={r.cieOutOf} low={lowCie(r, settings.lowMarksPct)} />
                        <ResultCell value={r.total} outOf={r.outOf} />
                      </Cells>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">* internal so far, from the tests entered. Total appears when every test (and the final exam, where there is one) is in. Red: internal below {settings.lowMarksPct}%. Includes marks not yet published.</p>
      </Card>
    </>
  );
}

function SubHeads({ cieOutOf, total }: { cieOutOf: number; total: number }) {
  return (
    <>
      <Th className="text-right">CIE /{cieOutOf}</Th>
      <Th className="text-right">Total /{total}</Th>
    </>
  );
}

function Cells({ children }: { children: [React.ReactNode, React.ReactNode] }) {
  return (
    <>
      <Td className="text-right">{children[0]}</Td>
      <Td className="border-r border-slate-100 text-right">{children[1]}</Td>
    </>
  );
}
