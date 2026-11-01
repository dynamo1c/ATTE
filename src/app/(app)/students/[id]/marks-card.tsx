import Link from "next/link";
import { EntryCell, ResultCell, lowCie, shortLabel } from "@/components/marks";
import { Card, Empty, Table, Td, Th } from "@/components/ui";
import { getClassMarks } from "@/server/marks-data";
import { getSettings } from "@/server/queries";

/** Every test of every subject for one student, with internal /50, final /50 and total. */
export async function StudentMarksCard({ studentId, classId }: { studentId: number; classId: number }) {
  const [{ subjects, students }, settings] = await Promise.all([getClassMarks(classId, { studentIds: [studentId] }), getSettings()]);
  const me = students[0];
  if (!me) return null;
  // Columns: the union of part codes in scheme order (main subjects and the minor differ).
  const codes = [...new Map(subjects.flatMap((s) => s.parts.filter((p) => !p.isFinal).map((p) => [p.code, p.label] as const))).entries()];

  return (
    <Card title="Marks this term" className="mb-6" actions={<span className="text-xs text-slate-500">Includes marks not yet published (°)</span>}>
      {subjects.length === 0 ? (
        <Empty>No subjects.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Subject</Th>
              {codes.map(([code, label]) => (
                <Th key={code} className="text-right">
                  <span title={label}>{shortLabel(code, label)}</span>
                </Th>
              ))}
              <Th className="text-right">CIE</Th>
              <Th className="text-right">Final exam</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((sub) => {
              const { marks, result } = me.subjects.get(sub.offeringId)!;
              const see = sub.parts.find((p) => p.isFinal);
              const status = new Map(sub.parts.map((p) => [p.code, p.status]));
              return (
                <tr key={sub.offeringId}>
                  <Td>
                    <Link href={`/marks/${sub.offeringId}`} className="text-blue-700 hover:underline" title={sub.subjectName}>
                      {sub.subject}
                    </Link>
                  </Td>
                  {codes.map(([code]) => (
                    <Td key={code} className="text-right">
                      {status.has(code) ? (
                        <>
                          <EntryCell entry={marks.get(code)} />
                          {marks.has(code) && status.get(code) !== "PUBLISHED" && <span className="text-amber-600">°</span>}
                        </>
                      ) : (
                        <span className="text-slate-200">·</span>
                      )}
                    </Td>
                  ))}
                  <Td className="text-right">
                    <ResultCell value={result.cie.scaled} soFar={result.cie.scaledSoFar} outOf={result.cieOutOf} low={lowCie(result, settings.lowMarksPct)} />
                  </Td>
                  <Td className="text-right">{see && result.seeOutOf !== null ? <EntryCell entry={marks.get(see.code)} /> : <span className="text-xs text-slate-400">no final</span>}</Td>
                  <Td className="text-right">
                    <ResultCell value={result.total} outOf={result.outOf} />
                    <span className="text-xs text-slate-400">/{result.outOf}</span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-slate-500">CIE = all tests + activity ÷ 250 × 50. Final exam ÷ 2. * = so far, from the tests entered. AB / MP count as 0.</p>
    </Card>
  );
}
