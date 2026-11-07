import Link from "next/link";
import { dayBlocks, rowSlots, type Slot } from "@/lib/domain/day-grid";
import type { LockState } from "@/lib/domain/marking";
import type { DayPeriod } from "@/server/department-day";

export interface GridClass {
  id: number;
  label: string;
  classTeacher: string | null;
}

export interface GridPeriod {
  ordinal: number;
  /** "09:00" */
  startsAt: string;
  endsAt: string;
}

/** 12-hour label like the printed timetable: "9:00", "1:30". */
const short = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")}`;
};

/**
 * One day of a department's timetable as a grid, like the printed sheet: classes down the side, periods
 * across (with the lunch break). On a phone it turns round: periods down the side, one column per class.
 * Every class period is a link to its attendance page.
 */
export function DayTimetable({ classes, periods, sessions, now, lock, viewerId }: { classes: GridClass[]; periods: GridPeriod[]; sessions: DayPeriod[]; now: string; lock: LockState; viewerId: number }) {
  const ordinals = periods.map((p) => p.ordinal);
  const slotsByClass = new Map(classes.map((c) => [c.id, rowSlots(ordinals, dayBlocks(sessions.filter((s) => s.classId === c.id)))]));
  // A lunch (or any) break sits between two periods whose times don't touch.
  const breakAfter = new Set(periods.filter((p, i) => periods[i + 1] && periods[i + 1].startsAt !== p.endsAt).map((p) => p.ordinal));
  const cell = (slot: Slot<DayPeriod>) => (slot.kind === "block" ? <Block sessions={slot.block.sessions} now={now} lock={lock} viewerId={viewerId} /> : null);

  return (
    <>
      {/* Desktop / tablet: classes are rows. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-24" />
            {periods.map((p) => [<col key={p.ordinal} />, breakAfter.has(p.ordinal) ? <col key={`b${p.ordinal}`} className="w-6" /> : null])}
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="border-b border-slate-200 px-2 py-2 text-left font-medium">Class</th>
              {periods.map((p) => [
                <th key={p.ordinal} className="border-b border-l border-slate-200 px-1 py-2 text-center font-medium tabular-nums">
                  {short(p.startsAt)}–{short(p.endsAt)}
                </th>,
                breakAfter.has(p.ordinal) ? <th key={`b${p.ordinal}`} className="border-b border-l border-slate-200" aria-label="Lunch" /> : null,
              ])}
            </tr>
          </thead>
          <tbody>
            {classes.map((c, row) => (
              <tr key={c.id} className="align-top">
                <th scope="row" className="border-b border-slate-200 px-2 py-2 text-left align-middle">
                  <div className="text-sm font-semibold text-slate-900">{c.label}</div>
                  {c.classTeacher && <div className="truncate font-normal text-slate-500">{c.classTeacher}</div>}
                </th>
                {slotsByClass.get(c.id)!.map((slot, i) => {
                  const p = periods[i];
                  const lunch = breakAfter.has(p.ordinal) ? (
                    row === 0 ? (
                      <td key={`b${p.ordinal}`} rowSpan={classes.length} className="border-b border-l border-slate-200 bg-slate-50 text-center align-middle text-[10px] font-medium uppercase leading-3 tracking-widest text-slate-400 [writing-mode:vertical-rl]">
                        Lunch
                      </td>
                    ) : null
                  ) : null;
                  if (slot.kind === "covered") return lunch;
                  return [
                    <td key={p.ordinal} colSpan={slot.kind === "block" ? slot.span : 1} className="border-b border-l border-slate-200 p-1">
                      {cell(slot)}
                    </td>,
                    lunch,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: periods are rows, one column per class. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white md:hidden">
        <table className="w-full table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-11" />
            {classes.map((c) => (
              <col key={c.id} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-slate-700">
              <th className="border-b border-slate-200 px-1 py-2" aria-label="Time" />
              {classes.map((c) => (
                <th key={c.id} className="border-b border-l border-slate-200 px-1 py-2 text-center text-xs font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => [
              <tr key={p.ordinal} className="align-top">
                <th scope="row" className="border-b border-slate-200 px-1 py-2 text-left font-medium tabular-nums text-slate-500">
                  {short(p.startsAt)}
                </th>
                {classes.map((c) => {
                  const slot = slotsByClass.get(c.id)![i];
                  if (slot.kind === "covered") return null;
                  return (
                    <td key={c.id} rowSpan={slot.kind === "block" ? slot.span : 1} className="border-b border-l border-slate-200 p-0.5">
                      {cell(slot)}
                    </td>
                  );
                })}
              </tr>,
              breakAfter.has(p.ordinal) ? (
                <tr key={`b${p.ordinal}`}>
                  <td colSpan={classes.length + 1} className="border-b border-slate-200 bg-slate-50 py-1 text-center text-[10px] font-medium uppercase tracking-widest text-slate-400">
                    Lunch
                  </td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One cell: the class(es) in that slot, each a link with its state. */
function Block({ sessions, now, lock, viewerId }: { sessions: DayPeriod[]; now: string; lock: LockState; viewerId: number }) {
  return (
    <div className="flex h-full flex-col gap-1">
      {sessions.map((s) => {
        const upcoming = s.status === "SCHEDULED" && s.startsAt > now;
        const state =
          s.status === "HELD"
            ? { tone: "border-green-300 bg-green-50", text: `✓ ${s.savedById === viewerId ? "You" : firstName(s.savedBy)}`, textTone: "text-green-800" }
            : s.status === "NOT_HELD"
              ? { tone: "border-slate-200 bg-slate-50", text: "Not held", textTone: "text-slate-500" }
              : s.status === "CANCELLED"
                ? { tone: "border-slate-200 bg-slate-50", text: "Cancelled", textTone: "text-slate-500" }
                : upcoming
                  ? { tone: "border-slate-200 bg-white", text: "Later", textTone: "text-slate-400" }
                  : lock === "LOCKED"
                    ? { tone: "border-red-300 bg-red-50", text: "Missed", textTone: "text-red-700" }
                    : { tone: "border-amber-400 bg-amber-50", text: "Take", textTone: "text-amber-800 font-semibold" };
        const body = (
          <div className={`rounded border px-1.5 py-1 leading-tight ${state.tone} ${s.mine ? "ring-1 ring-blue-400" : ""}`}>
            <div className="hyphens-auto break-words font-semibold text-slate-900" lang="en">
              {s.subject}
              {s.component === "PRACTICAL" && " Lab"}
              {s.batchScope !== "ALL" && <span className="ml-1 font-normal text-slate-500">{s.batchScope}</span>}
            </div>
            <div className="truncate text-slate-500">{s.teachers ? s.teachers.split(", ").map(firstName).join(", ") : "—"}</div>
            <div className={`truncate ${state.textTone}`}>{state.text}</div>
          </div>
        );
        return upcoming ? (
          <div key={s.id} title={`${s.subject} starts at ${s.startsAt}`}>
            {body}
          </div>
        ) : (
          <Link key={s.id} href={`/attendance/${s.id}`} className="block hover:opacity-80" title={`${s.subject} ${s.startsAt}–${s.endsAt} · ${s.teachers ?? "no teacher"}${s.savedBy ? ` · saved by ${s.savedBy}${s.savedAt ? ` at ${s.savedAt}` : ""}` : ""}`}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}

const firstName = (name: string | null) => (name ? name.split(" ")[0] : "");
