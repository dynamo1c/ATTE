import { sql } from "drizzle-orm";
import Link from "next/link";
import { PartChip } from "@/components/marks";
import { Card, Empty, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { canEnterMarks, classTeacherClassIds, hodDepartmentIds, seesWholeCollege } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listOfferingMarks } from "@/server/marks-data";
import { getCurrentTerm } from "@/server/queries";

export const metadata = { title: "Marks · MEI Attendance" };

export default async function MarksPage(props: PageProps<"/marks">) {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="marks (no term set up)" />;
  const sp = await props.searchParams;
  const depts = hodDepartmentIds(me.actor);
  const wide = seesWholeCollege(me.actor) || depts.length > 0;
  const scope = wide && sp.scope === "mine" ? "mine" : wide ? "all" : "mine";

  const own = [...new Set([...classTeacherClassIds(me.actor)])];
  const where =
    scope === "mine"
      ? sql`cg.term_id = ${term.id} AND (EXISTS (SELECT 1 FROM teaching_assignment ta WHERE ta.offering_id = o.id AND ta.staff_id = ${me.id})
             ${own.length ? sql`OR cg.id IN (${sql.join(own.map((c) => sql`${c}`), sql`, `)})` : sql``})`
      : seesWholeCollege(me.actor)
        ? sql`cg.term_id = ${term.id}`
        : sql`cg.term_id = ${term.id} AND cg.department_id IN (${sql.join(depts.map((d) => sql`${d}`), sql`, `)})`;
  const offerings = await listOfferingMarks(where);
  if (offerings.length === 0 && !wide) return <NoAccess what="marks (you don't teach any subject this term)" />;


  return (
    <>
      <PageHeader
        title="Marks"
        subtitle="Internal (CIE): all tests + activity, scaled to 50. Final exam: out of 100, scaled to 50. Decimals kept; AB and MP count as 0."
      />

      {wide && (
        <div className="mb-4 flex gap-2 text-sm">
          <Link href="/marks" className={scope === "all" ? "font-semibold text-blue-800" : "text-slate-600 hover:underline"}>
            {seesWholeCollege(me.actor) ? "All subjects" : "Department"}
          </Link>
          <span className="text-slate-300">|</span>
          <Link href="/marks?scope=mine" className={scope === "mine" ? "font-semibold text-blue-800" : "text-slate-600 hover:underline"}>
            My subjects
          </Link>
        </div>
      )}

      <Card title={scope === "mine" ? "Your subjects" : "Subjects"}>
        {offerings.length === 0 ? (
          <Empty>No subjects.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Subject</Th>
                <Th>Tests</Th>
              </tr>
            </thead>
            <tbody>
              {offerings.map((o) => (
                <tr key={o.offeringId}>
                  <Td className="whitespace-nowrap">{o.className}</Td>
                  <Td>
                    <Link href={`/marks/${o.offeringId}`} className="text-blue-700 hover:underline">
                      {o.subject}
                    </Link>
                    <div className="text-xs text-slate-500">{o.schemeName}</div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {o.parts.map((p) => (
                        <PartChip
                          key={p.code}
                          href={`/marks/${o.offeringId}/${p.code}`}
                          part={p}
                          mine={canEnterMarks(me.actor, { classRef: o.classRef, assignedStaffIds: p.assignedStaffIds })}
                        />
                      ))}
                    </div>
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
