import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { Badge, Card, Empty } from "@/components/ui";
import { addDays, formatDateShort, todayIn } from "@/lib/domain/dates";
import { requireParent } from "@/server/parent-session";
import { getCurrentTerm } from "@/server/queries";

export const metadata = { title: "Calendar · Parent portal · MEI Polytechnic" };

type DayType = "HOLIDAY" | "EXAM" | "EVENT" | "WORKING";
const TYPE: Record<DayType, { label: string; tone: "red" | "amber" | "blue" | "green" }> = {
  HOLIDAY: { label: "Holiday · ರಜೆ", tone: "red" },
  EXAM: { label: "Exam · ಪರೀಕ್ಷೆ", tone: "amber" },
  EVENT: { label: "Event · ಕಾರ್ಯಕ್ರಮ", tone: "blue" },
  WORKING: { label: "Working day · ಕೆಲಸದ ದಿನ", tone: "green" },
};

interface Entry {
  from: string;
  to: string;
  type: DayType;
  note: string | null;
  scope: string | null;
}

export default async function ParentCalendarPage() {
  const me = await requireParent();
  const term = await getCurrentTerm();
  const today = todayIn();
  const classIds = me.children.flatMap((c) => (c.classId ? [sql`${c.classId}`] : []));
  const deptIds = me.children.flatMap((c) => (c.departmentId ? [sql`${c.departmentId}`] : []));
  const from = term?.startsOn ?? today;
  const to = term?.endsOn ?? addDays(today, 120);
  const { rows } = await getDb().execute<{ date: string; type: DayType; note: string | null; scope: string | null }>(sql`
    SELECT to_char(cd.date, 'YYYY-MM-DD') AS date, cd.type, cd.note,
           COALESCE(d.code || ' only', cdd.code || ' Sem ' || cg.semester || ' only') AS scope
    FROM calendar_day cd
    LEFT JOIN department d ON d.id = cd.department_id
    LEFT JOIN class_group cg ON cg.id = cd.class_group_id
    LEFT JOIN department cdd ON cdd.id = cg.department_id
    WHERE cd.date BETWEEN ${from} AND ${to}
      AND ((cd.department_id IS NULL AND cd.class_group_id IS NULL)
        ${deptIds.length ? sql`OR cd.department_id IN (${sql.join(deptIds, sql`, `)})` : sql``}
        ${classIds.length ? sql`OR cd.class_group_id IN (${sql.join(classIds, sql`, `)})` : sql``})
    ORDER BY cd.date, cd.id`);

  // Consecutive days with the same note (e.g. a 3-day exam) show as one line.
  const entries: Entry[] = [];
  for (const r of rows) {
    const last = entries.at(-1);
    if (last && last.type === r.type && last.note === r.note && last.scope === r.scope && addDays(last.to, 1) === r.date) last.to = r.date;
    else entries.push({ from: r.date, to: r.date, type: r.type, note: r.note, scope: r.scope });
  }
  const upcoming = entries.filter((e) => e.to >= today);
  const past = entries.filter((e) => e.to < today).reverse();

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">College calendar · ಕಾಲೇಜು ಕ್ಯಾಲೆಂಡರ್</h1>
      <p className="mb-4 text-sm text-slate-500">Holidays, exams and events this term. Days not listed are normal working days (Sunday holiday).</p>
      <Card title="Coming up · ಮುಂಬರುವ" className="mb-4">
        <EntryList entries={upcoming} empty="Nothing planned yet." />
      </Card>
      {past.length > 0 && (
        <Card title="Earlier this term · ಹಿಂದಿನ">
          <EntryList entries={past} empty="" />
        </Card>
      )}
    </>
  );
}

function EntryList({ entries, empty }: { entries: Entry[]; empty: string }) {
  if (entries.length === 0) return <Empty>{empty}</Empty>;
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short" });
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((e) => (
        <li key={`${e.from}-${e.type}-${e.scope}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
          <span className="w-40 shrink-0 text-sm tabular-nums text-slate-900">
            {e.from === e.to ? `${day(e.from)}, ${formatDateShort(e.from)}` : `${formatDateShort(e.from)} – ${formatDateShort(e.to)}`}
          </span>
          <Badge tone={TYPE[e.type].tone}>{TYPE[e.type].label}</Badge>
          <span className="text-sm text-slate-700">
            {e.note}
            {e.scope && <span className="text-xs text-slate-500"> ({e.scope})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
