import "server-only";
/**
 * Excel downloads (docs/PLAN.md §9). Each builder checks the same permission as its screen and reads
 * the same data, so a download never shows more, or different numbers, than the screen.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { canViewClass, canViewCompliance, canViewMessages } from "@/lib/auth/permissions";
import { formatPercent, percent, type Standing, type Tally } from "@/lib/domain/attendance";
import { formatDateShort, isIsoDate, todayIn } from "@/lib/domain/dates";
import { formatEntry, formatMark, type MarkEntry } from "@/lib/domain/marks";
import { formatIndianMobile } from "@/lib/domain/phone";
import { monthRange, REGISTER_CODE, REGISTER_LEGEND } from "@/lib/domain/register";
import { TRIGGER_LABEL, type Trigger } from "@/lib/notify/rules";
import { fileName, type Cell, type Sheet } from "@/lib/xlsx";
import { getClassAttendance, isCurrent } from "./attendance-report";
import type { CurrentStaff } from "./current";
import { getClassMarks, STATUS_LABEL } from "./marks-data";
import { getClass, getCurrentTerm, getSettings, listVisibleClasses, parseId } from "./queries";
import { loadShortage, loadUnentered, messageFilters, messageWhere, shortageFilters } from "./report-data";

type Params = Record<string, string | string[] | undefined>;
export type ExportResult = { ok: true; file: string; sheets: Sheet[] } | { ok: false; status: 403 | 404; error: string };

const today = () => todayIn();
const forbidden = (what: string): ExportResult => ({ ok: false, status: 403, error: `You don't have access to ${what}.` });
const notFound: ExportResult = { ok: false, status: 404, error: "Not found." };

/** Percent as a number with one decimal, floored exactly like the screens (61.19 → 61.1). */
function pctCell(t: Tally, standing?: Standing): Cell {
  const p = percent(t);
  if (p === null) return null;
  return { value: Number(formatPercent(p).replace("%", "")), style: standing === "SHORTAGE" ? "pctRed" : "pct" };
}

const markNumber = (n: number | null) => (n === null ? null : Number(formatMark(n)));
const entryCell = (e: MarkEntry | undefined): Cell => (!e ? null : e.flag ? { value: e.flag, style: "red" } : Number(formatEntry(e)));

async function classFor(me: CurrentStaff, sp: Params) {
  const id = parseId(typeof sp.class === "string" ? sp.class : "");
  const cls = id ? await getClass(id) : null;
  if (!cls) return { error: notFound };
  if (!canViewClass(me.actor, cls)) return { error: forbidden("this class") };
  return { cls, name: `${cls.departmentCode} Sem ${cls.semester}` };
}

// ---------------------------------------------------------------------------

async function shortage(me: CurrentStaff, sp: Params): Promise<ExportResult> {
  const term = await getCurrentTerm();
  if (!term) return notFound;
  const visible = await listVisibleClasses(me.actor, term.id);
  if (!visible.length) return forbidden("attendance reports");
  const f = shortageFilters(visible, sp);
  const r = await loadShortage(visible, f);
  const scope = [f.deptId ? f.depts.find(([id]) => id === f.deptId)?.[1] : "All departments", f.sem ? `Sem ${f.sem}` : "all semesters"].join(", ");
  return {
    ok: true,
    file: fileName("attendance", f.level === "risk" ? "shortage-and-at-risk" : "shortage", today()),
    sheets: [
      {
        name: "Shortage",
        title: f.level === "risk" ? `Students below ${r.warnPct}% in a subject` : `Students below ${r.minPct}% in a subject`,
        notes: [
          `${scope} · up to ${formatDateShort(r.to ?? today())} · rule: at least ${r.minPct}% in every subject (theory + lab together)`,
          `${r.shortCount} below ${r.minPct}% of ${r.studentsCovered} students in ${r.classes.length} classes${r.unmarked ? ` · ${r.unmarked} classes not yet entered (not counted)` : ""}`,
        ],
        header: ["Class", "Reg no", "Student", "Subjects", "Lowest subject %", "Overall %", "Must attend next", "Status"],
        rows: r.rows.map(({ cls, s, weak, worstPct, need }) => [
          `${cls.departmentCode} Sem ${cls.semester}`,
          s.regNo,
          s.name,
          weak.map((w) => `${w.subject.shortName} ${formatPercent(percent(w.o.total))}`).join(", "),
          { value: Number(formatPercent(worstPct).replace("%", "")), style: s.standing === "SHORTAGE" ? "pctRed" : "pct" },
          pctCell(s.attendance.overall),
          need > 0 ? `${need} classes in a row` : null,
          s.standing === "SHORTAGE" ? { value: `Below ${r.minPct}%`, style: "red" } : "At risk",
        ]),
        widths: [12, 12, 26, 40, 10, 10, 18, 12],
        freezeCols: 3,
      },
    ],
  };
}

async function classAttendance(me: CurrentStaff, sp: Params): Promise<ExportResult> {
  const c = await classFor(me, sp);
  if ("error" in c) return c.error!;
  let from = isIsoDate(sp.from) ? sp.from : null;
  let to = isIsoDate(sp.to) ? sp.to : null;
  if (from && to && from > to) [from, to] = [to, from];
  const data = await getClassAttendance(c.cls.id, { from, to });
  const students = [...data.students.filter(isCurrent), ...data.students.filter((s) => !isCurrent(s))];
  const range = from || to ? `${from ? formatDateShort(from) : "Term start"} – ${formatDateShort(data.to)}` : `Whole term to ${formatDateShort(data.to)}`;
  const notes = [`${range} · minimum ${data.minPct}% in every subject (theory + lab together), at risk below ${data.warnPct}%`, data.unmarkedSessions ? `${data.unmarkedSessions} classes not yet entered: left out of the percentages until entered.` : `${data.heldSessions} classes counted.`];
  const left = (s: (typeof students)[number]) => (isCurrent(s) ? "" : ` (left${s.leftOn ? ` ${formatDateShort(s.leftOn)}` : ""})`);

  const summary: Sheet = {
    name: "Eligibility",
    title: `${c.name} · Attendance and exam eligibility`,
    notes,
    header: ["Roll", "Reg no", "Student", ...data.subjects.map((s) => `${s.shortName} %`), "Overall %", "Attended", "Counted", "Exam eligibility (attendance)", "Below minimum in"],
    rows: students.map((s) => {
      const by = new Map(s.attendance.byOffering.map((o) => [o.offeringId, o]));
      const short = data.subjects.filter((sub) => s.subjectStanding.get(sub.offeringId) === "SHORTAGE").map((sub) => sub.shortName);
      return [
        s.roll,
        s.regNo,
        `${s.name}${left(s)}`,
        ...data.subjects.map((sub) => {
          const o = by.get(sub.offeringId);
          return o ? pctCell(o.total, s.subjectStanding.get(sub.offeringId)) : null;
        }),
        pctCell(s.attendance.overall),
        s.attendance.overall.attended,
        s.attendance.overall.counted,
        !isCurrent(s) ? "Left the class" : s.standing === "NO_DATA" ? "No classes yet" : short.length ? { value: "Not eligible", style: "red" } : "Eligible",
        short.join(", ") || null,
      ];
    }),
    widths: [6, 12, 26, ...data.subjects.map(() => 9), 9, 9, 9, 16, 24],
    freezeCols: 3,
    footer: ["Eligibility here is by attendance only. Final eligibility is decided by the college after the condonation / marks rules."],
  };
  const detail: Sheet = {
    name: "By subject",
    title: `${c.name} · Attendance by subject`,
    notes,
    header: ["Roll", "Reg no", "Student", "Subject", "Theory attended", "Theory held", "Lab attended", "Lab held", "Total %", "Late", "Status"],
    rows: students.flatMap((s) =>
      data.subjects.map((sub): Cell[] => {
        const o = s.attendance.byOffering.find((x) => x.offeringId === sub.offeringId);
        const st = s.subjectStanding.get(sub.offeringId) ?? "NO_DATA";
        return [
          s.roll,
          s.regNo,
          `${s.name}${left(s)}`,
          sub.shortName,
          sub.hasTheory ? (o?.theory.attended ?? 0) : null,
          sub.hasTheory ? (o?.theory.counted ?? 0) : null,
          sub.hasPractical ? (o?.practical.attended ?? 0) : null,
          sub.hasPractical ? (o?.practical.counted ?? 0) : null,
          o ? pctCell(o.total, st) : null,
          o?.total.late || null,
          st === "SHORTAGE" ? { value: `Below ${data.minPct}%`, style: "red" } : st === "AT_RISK" ? "At risk" : st === "OK" ? "OK" : "No classes",
        ];
      }),
    ),
    freezeCols: 3,
  };
  return { ok: true, file: fileName(c.name, "attendance", today()), sheets: [summary, detail] };
}

async function register(me: CurrentStaff, sp: Params): Promise<ExportResult> {
  const c = await classFor(me, sp);
  if ("error" in c) return c.error!;
  const month = monthRange(sp.month);
  if (!month) return { ok: false, status: 404, error: "Choose a month." };
  const data = await getClassAttendance(c.cls.id, { from: month.from, to: month.to, detailFrom: month.from });
  const { rows: sessions } = await getDb().execute<{ id: number; date: string; period: number; subject: string; component: string; batch_scope: string }>(sql`
    SELECT cs.id, to_char(cs.date, 'YYYY-MM-DD') AS date, cs.start_period AS period, c.short_name AS subject, cs.component::text, cs.batch_scope::text
    FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id JOIN course c ON c.id = o.course_id
    WHERE o.class_group_id = ${c.cls.id} AND cs.date BETWEEN ${month.from}::date AND ${data.to}::date AND cs.status IN ('HELD', 'SCHEDULED')
    ORDER BY cs.date, cs.start_period, c.short_name`);
  const students = [...data.students.filter(isCurrent), ...data.students.filter((s) => !isCurrent(s))].filter((s) => s.outcomes?.length);
  const label = new Date(`${month.from}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
  const head = (s: (typeof sessions)[number]) => {
    const d = new Date(`${s.date}T00:00:00Z`);
    const day = `${d.getUTCDate()} ${d.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short" })}`;
    return `${day}\nP${s.period}\n${s.subject}${s.component === "PRACTICAL" ? " lab" : ""}${s.batch_scope !== "ALL" ? ` ${s.batch_scope}` : ""}`;
  };
  return {
    ok: true,
    file: fileName(c.name, "register", sp.month as string),
    sheets: [
      {
        name: label,
        title: `${c.name} · Attendance register · ${label}`,
        notes: [`${sessions.length} classes up to ${formatDateShort(data.to)} · month totals on the right (minimum ${data.minPct}% per subject applies to the whole term, not one month)`],
        header: ["Roll", "Reg no", "Student", ...sessions.map(head), "Attended", "Counted", "Month %"],
        rows: students.map((s) => {
          const by = new Map(s.outcomes!.map((o) => [o.sessionId, o.outcome]));
          return [
            s.roll,
            s.regNo,
            s.name,
            ...sessions.map((x): Cell => {
              const code = REGISTER_CODE[by.get(x.id) ?? "NOT_APPLICABLE"];
              return code ? { value: code, style: code.startsWith("A") ? "centerRed" : code === "?" ? "centerMuted" : "center" } : null;
            }),
            s.attendance.overall.attended,
            s.attendance.overall.counted,
            pctCell(s.attendance.overall),
          ];
        }),
        widths: [6, 12, 24, ...sessions.map(() => 7), 9, 9, 9],
        freezeCols: 3,
        footer: [REGISTER_LEGEND],
      },
    ],
  };
}

async function classMarks(me: CurrentStaff, sp: Params): Promise<ExportResult> {
  const c = await classFor(me, sp);
  if ("error" in c) return c.error!;
  const [{ subjects, students }, settings] = await Promise.all([getClassMarks(c.cls.id), getSettings()]);
  const rows = [...students.filter((s) => s.current), ...students.filter((s) => !s.current)];
  const name = (s: (typeof rows)[number]) => `${s.name}${s.current ? "" : " (left)"}`;
  const resultCell = (value: number | null, soFar: number | null, low = false): Cell =>
    value !== null ? { value: markNumber(value), style: low ? "red" : undefined } : soFar !== null ? { value: markNumber(soFar), style: "muted" } : null;
  const isLow = (v: number | null, outOf: number) => v !== null && v * 100 < settings.lowMarksPct * outOf;
  const footer = ["CIE = all tests + activity ÷ 250 × 50 · final exam ÷ 2 · total = CIE + final. AB / MP count as 0.", "Grey italic = so far, from the tests entered (not final until every test is in). Red = below the low-marks level in Settings."];

  const summary: Sheet = {
    name: "Summary",
    title: `${c.name} · Internal marks (CIE) and totals`,
    notes: [`As of ${formatDateShort(today())} · includes marks not yet published (see each subject's sheet for the status of every test)`],
    header: ["Roll", "Reg no", "Student", ...subjects.flatMap((s) => [`${s.subject}\nCIE /${s.formula.cieOutOf}`, `${s.subject}\nTotal /${s.formula.cieOutOf + (s.formula.seeOutOf ?? 0)}`])],
    rows: rows.map((s) => [
      s.roll,
      s.regNo,
      name(s),
      ...subjects.flatMap((sub) => {
        const { result } = s.subjects.get(sub.offeringId)!;
        return [resultCell(result.cie.scaled, result.cie.scaledSoFar, isLow(result.cie.scaled ?? result.cie.scaledSoFar, result.cieOutOf)), resultCell(result.total, null)];
      }),
    ]),
    widths: [6, 12, 26, ...subjects.flatMap(() => [10, 10])],
    freezeCols: 3,
    footer,
  };
  const perSubject: Sheet[] = subjects.map((sub) => ({
    name: sub.subject,
    title: `${c.name} · ${sub.subject}${sub.subjectName !== sub.subject ? ` (${sub.subjectName})` : ""} · Marks`,
    notes: [sub.parts.map((p) => `${p.label}: ${p.status ? STATUS_LABEL[p.status] : "Not started"}`).join(" · ")],
    header: ["Roll", "Reg no", "Student", ...sub.parts.map((p) => `${p.label}\n/${p.maxMarks}${p.status && p.status !== "PUBLISHED" ? `\n(${STATUS_LABEL[p.status].toLowerCase()})` : ""}`), `CIE\n/${sub.formula.cieOutOf}`, ...(sub.formula.seeOutOf !== null ? [`Final\n/${sub.formula.seeOutOf}`] : []), `Total\n/${sub.formula.cieOutOf + (sub.formula.seeOutOf ?? 0)}`],
    rows: rows.map((s) => {
      const { marks, result } = s.subjects.get(sub.offeringId)!;
      return [
        s.roll,
        s.regNo,
        name(s),
        ...sub.parts.map((p) => entryCell(marks.get(p.code))),
        resultCell(result.cie.scaled, result.cie.scaledSoFar, isLow(result.cie.scaled ?? result.cie.scaledSoFar, result.cieOutOf)),
        ...(sub.formula.seeOutOf !== null ? [resultCell(result.see?.scaled ?? null, null)] : []),
        resultCell(result.total, null),
      ];
    }),
    widths: [6, 12, 26, ...sub.parts.map(() => 11), 9, ...(sub.formula.seeOutOf !== null ? [9] : []), 9],
    freezeCols: 3,
    footer,
  }));
  return { ok: true, file: fileName(c.name, "marks", today()), sheets: [summary, ...perSubject] };
}

async function unentered(me: CurrentStaff): Promise<ExportResult> {
  if (!canViewCompliance(me.actor)) return forbidden("this report");
  const term = await getCurrentTerm();
  if (!term) return notFound;
  const classes = await listVisibleClasses(me.actor, term.id);
  if (!classes.length) return forbidden("this report");
  const { rows, today: t } = await loadUnentered(me.actor, classes);
  return {
    ok: true,
    file: fileName("classes-not-entered", t),
    sheets: [
      {
        name: "Not entered",
        title: "Classes whose attendance has not been entered",
        notes: [`As of ${formatDateShort(t)} · they are left out of every percentage until entered`],
        header: ["Date", "Time", "Class", "Subject", "Part", "Batch", "Teacher", "Teacher's dept", "Overdue"],
        rows: rows.map((r) => [
          formatDateShort(r.date),
          r.starts_at,
          r.class_name,
          r.subject,
          r.component === "PRACTICAL" ? "Lab" : "Theory",
          r.batch_scope === "ALL" ? null : r.batch_scope,
          r.staff_name ?? { value: "No teacher assigned", style: "red" },
          r.staff_dept,
          r.date < t ? { value: "Overdue", style: "red" } : "Today",
        ]),
        widths: [12, 7, 12, 14, 8, 7, 24, 12, 10],
      },
    ],
  };
}

const MESSAGE_EXPORT_LIMIT = 20_000;

async function messages(me: CurrentStaff, sp: Params): Promise<ExportResult> {
  if (!canViewMessages(me.actor)) return forbidden("parent messages");
  const term = await getCurrentTerm();
  if (!term) return notFound;
  const f = messageFilters(sp);
  const { rows } = await getDb().execute<{
    at: string;
    sent: string | null;
    trigger: Trigger;
    channel: string;
    status: string;
    phone: string;
    attempts: number;
    last_error: string | null;
    text: string;
    student_name: string | null;
    reg_no: string | null;
    relation: string | null;
  }>(sql`
    SELECT to_char(n.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS at,
           to_char(n.sent_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS sent,
           n.trigger::text AS trigger, n.channel::text AS channel, n.status::text AS status, n.phone, n.attempts, n.last_error,
           n.payload->>'text' AS text, s.name AS student_name, s.reg_no, pc.relation::text AS relation
    FROM notification n
    LEFT JOIN student s ON s.id = n.student_id
    LEFT JOIN parent_contact pc ON pc.id = n.parent_contact_id
    WHERE ${messageWhere(me.actor, term.id, f)}
    ORDER BY n.id DESC
    LIMIT ${MESSAGE_EXPORT_LIMIT}`);
  const filters = [f.status && `status ${f.status.toLowerCase()}`, f.trigger && TRIGGER_LABEL[f.trigger], f.q && `search "${f.q}"`].filter(Boolean).join(", ");
  return {
    ok: true,
    file: fileName("parent-messages", today()),
    sheets: [
      {
        name: "Messages",
        title: "Parent message delivery report",
        notes: [`${filters || "All messages"} · newest first${rows.length === MESSAGE_EXPORT_LIMIT ? ` · first ${MESSAGE_EXPORT_LIMIT.toLocaleString("en-IN")} only` : ""}`],
        header: ["Queued", "Sent", "Student", "Reg no", "To", "Phone", "Message", "Channel", "Status", "Tries", "Error", "Text"],
        rows: rows.map((r) => [
          r.at,
          r.sent,
          r.student_name,
          r.reg_no,
          r.relation ? r.relation.charAt(0) + r.relation.slice(1).toLowerCase() : null,
          formatIndianMobile(r.phone),
          TRIGGER_LABEL[r.trigger] ?? r.trigger,
          r.channel === "WHATSAPP" ? "WhatsApp" : "SMS",
          r.status === "FAILED" ? { value: "Failed", style: "red" } : r.status.charAt(0) + r.status.slice(1).toLowerCase(),
          r.attempts,
          r.last_error,
          r.text,
        ]),
        widths: [16, 16, 24, 12, 9, 13, 26, 10, 10, 6, 30, 60],
      },
    ],
  };
}

export const EXPORTS = {
  shortage,
  "class-attendance": classAttendance,
  register,
  "class-marks": classMarks,
  unentered: (me: CurrentStaff) => unentered(me),
  messages,
} as const satisfies Record<string, (me: CurrentStaff, sp: Params) => Promise<ExportResult>>;

export type ExportKind = keyof typeof EXPORTS;
export const isExportKind = (k: string): k is ExportKind => Object.hasOwn(EXPORTS, k);
