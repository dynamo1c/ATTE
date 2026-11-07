import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryCell, PartChip, ResultCell, lowCie, shortLabel } from "@/components/marks";
import { Card, Empty, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { canEnterMarks, canViewClass } from "@/lib/auth/permissions";
import { formatDateShort } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { STATUS_LABEL, getClassMarks, getOfferingMarks } from "@/server/marks-data";
import { getSettings, parseId } from "@/server/queries";

export const metadata = { title: "Subject marks · MEI Attendance" };

export default async function SubjectMarksPage(props: PageProps<"/marks/[offeringId]">) {
  const me = await requireStaff();
  const id = parseId((await props.params).offeringId);
  const ctx = id ? await getOfferingMarks(id) : null;
  if (!ctx) notFound();
  if (!canViewClass(me.actor, ctx.classRef)) return <NoAccess what="this subject" />;
  const [{ subjects, students }, settings] = await Promise.all([getClassMarks(ctx.classRef.id), getSettings()]);
  const subject = subjects.find((s) => s.offeringId === ctx.offeringId)!;
  const hasSee = ctx.formula.seeOutOf !== null && ctx.parts.some((p) => p.isFinal);
  const cieParts = subject.parts.filter((p) => !p.isFinal);
  const seePart = subject.parts.find((p) => p.isFinal);
  const rows = [...students.filter((s) => s.current), ...students.filter((s) => !s.current)];

  return (
    <>
      <PageHeader
        title={`${ctx.className} · ${ctx.subject}`}
        subtitle={`${ctx.subjectName} · ${ctx.schemeName}`}
        back={{ href: "/marks", label: "Marks" }}
      />

      <Card title="Tests" className="mb-6">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ctx.parts.map((p) => {
            const mine = canEnterMarks(me.actor, { classRef: ctx.classRef, assignedStaffIds: p.assignedStaffIds });
            return (
              <li key={p.code} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{p.label}</div>
                    <div className="text-xs text-slate-500">
                      Out of {p.maxMarks}
                      {p.assessment?.heldOn && ` · ${formatDateShort(p.assessment.heldOn)}`}
                      {" · "}
                      {p.assignedNames ?? "no teacher assigned"}
                    </div>
                  </div>
                  <PartChip href={`/marks/${ctx.offeringId}/${p.code}`} part={p} mine={mine} />
                </div>
                {(mine || p.assessment) && (
                  <Link href={`/marks/${ctx.offeringId}/${p.code}`} className="mt-2 inline-block text-sm text-blue-700 hover:underline">
                    {mine && p.assessment?.status !== "PUBLISHED" ? (p.assessment?.marked ? "Continue entering →" : "Enter marks →") : `View ${p.assessment ? STATUS_LABEL[p.assessment.status].toLowerCase() : ""} marks →`}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Results">
        {rows.length === 0 ? (
          <Empty>No students.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Roll</Th>
                <Th>Student</Th>
                {cieParts.map((p) => (
                  <Th key={p.code} className="text-right">
                    <span title={`${p.label} (/${p.maxMarks}) — ${p.status ? STATUS_LABEL[p.status].toLowerCase() : "not started"}`}>
                      {shortLabel(p.code, p.label)}
                      {p.status !== "PUBLISHED" && <span className="text-amber-600">°</span>}
                    </span>
                  </Th>
                ))}
                <Th className="text-right">CIE /{ctx.formula.cieOutOf}</Th>
                {hasSee && seePart && (
                  <>
                    <Th className="text-right">
                      Final /{seePart.maxMarks}
                      {seePart.status !== "PUBLISHED" && <span className="text-amber-600">°</span>}
                    </Th>
                    <Th className="text-right">Final /{ctx.formula.seeOutOf}</Th>
                  </>
                )}
                <Th className="text-right">Total /{subject.formula.cieOutOf + (hasSee ? (subject.formula.seeOutOf ?? 0) : 0)}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const sub = s.subjects.get(ctx.offeringId)!;
                const r = sub.result;
                return (
                  <tr key={s.studentId} className={s.current ? undefined : "opacity-50"}>
                    <Td className="tabular-nums">{s.roll}</Td>
                    <Td>
                      <Link href={`/students/${s.studentId}`} className="text-blue-700 hover:underline">
                        {s.name}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">{s.regNo}</div>
                    </Td>
                    {cieParts.map((p) => (
                      <Td key={p.code} className="text-right">
                        <EntryCell entry={sub.marks.get(p.code)} />
                      </Td>
                    ))}
                    <Td className="text-right">
                      <ResultCell value={r.cie.scaled} soFar={r.cie.scaledSoFar} outOf={r.cieOutOf} low={lowCie(r, settings.lowMarksPct)} />
                    </Td>
                    {hasSee && seePart && (
                      <>
                        <Td className="text-right">
                          <EntryCell entry={sub.marks.get(seePart.code)} />
                        </Td>
                        <Td className="text-right">
                          <ResultCell value={r.see?.scaled ?? null} outOf={r.seeOutOf ?? 0} />
                        </Td>
                      </>
                    )}
                    <Td className="text-right">
                      <ResultCell value={r.total} outOf={r.outOf} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          ° not published yet (staff see drafts; parents see only published marks). * internal so far, from the tests entered — final once every test is in. Red: below {settings.lowMarksPct}%.
        </p>
      </Card>
    </>
  );
}
