import { notFound } from "next/navigation";
import { PrintButton } from "@/components/report-actions";
import { StudentAttendanceCard } from "@/components/student-attendance-card";
import { StudentMarksCard } from "@/components/student-marks-card";
import { NoAccess, PageHeader } from "@/components/ui";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, parseId } from "@/server/queries";
import { canViewStudent, getStudent } from "@/server/student-data";

export const metadata = { title: "Report card · MEI Attendance" };

/** Printable report card: attendance per subject + published marks (what parents may see). */
export default async function ReportCardPage(props: PageProps<"/students/[id]/report-card">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  if (!id) notFound();
  const term = await getCurrentTerm();
  const s = await getStudent(id, term?.id ?? null);
  if (!s) notFound();
  if (!canViewStudent(me.actor, s)) return <NoAccess what="this student" />;
  const m = s.membership;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print">
        <PageHeader
          title="Report card"
          subtitle="Attendance and published marks only (drafts and marks waiting for the HOD are left out). Print, or choose “Save as PDF” in the print window."
          back={{ href: `/students/${s.id}`, label: s.name }}
          actions={<PrintButton />}
        />
      </div>

      <header className="mb-5 border-b-2 border-slate-800 pb-3 text-center">
        <p className="text-lg font-bold uppercase tracking-wide text-slate-900">MEI Polytechnic, Bengaluru</p>
        <p className="text-sm text-slate-600">Student progress report{term ? ` · ${term.kind === "ODD" ? "Odd" : "Even"} semester from ${formatDateShort(term.startsOn)}` : ""}</p>
      </header>

      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Name</dt>
          <dd className="font-semibold">{s.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Register number</dt>
          <dd className="font-mono font-semibold">{s.regNo}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Class</dt>
          <dd className="font-semibold">{m ? `${m.classDept} Sem ${m.semester}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">As of</dt>
          <dd className="font-semibold">{formatDateShort(todayIn())}</dd>
        </div>
      </dl>

      {m ? (
        <>
          <StudentAttendanceCard studentId={s.id} classId={m.classGroupId} forParent />
          <StudentMarksCard studentId={s.id} classId={m.classGroupId} forParent />
        </>
      ) : (
        <p className="text-sm text-slate-600">Not in a class this term.</p>
      )}

      <div className="mt-14 grid grid-cols-3 gap-8 text-center text-xs text-slate-600">
        {["Class teacher", "Head of department", "Principal"].map((r) => (
          <div key={r} className="border-t border-slate-400 pt-1">
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}
