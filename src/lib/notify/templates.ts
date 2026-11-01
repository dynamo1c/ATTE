/**
 * Parent message texts, English + Kannada (docs/PLAN.md §8.2). Pure functions with unit tests.
 *
 * The Kannada wording MUST be checked by college staff before these are submitted to Meta as
 * WhatsApp templates (and to DLT for SMS). Keep messages short, factual, and free of anything
 * beyond what the parent needs.
 */
import { formatDateShort, isoWeekday, type IsoDate } from "../domain/dates";

export type Language = "EN" | "KN" | "BOTH";

export const COLLEGE_EN = "MEI Polytechnic";
export const COLLEGE_KN = "ಎಂ.ಇ.ಐ. ಪಾಲಿಟೆಕ್ನಿಕ್";

const KN_MONTHS = ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"];
const EN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KN_DAYS = ["ಸೋಮ", "ಮಂಗಳ", "ಬುಧ", "ಗುರು", "ಶುಕ್ರ", "ಶನಿ", "ಭಾನು"];

/** "31 ಅಕ್ಟೋಬರ್ 2026" */
export function formatDateKn(d: IsoDate): string {
  return `${Number(d.slice(8, 10))} ${KN_MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

const dayEn = (d: IsoDate) => EN_DAYS[isoWeekday(d) - 1];
const dayKn = (d: IsoDate) => KN_DAYS[isoWeekday(d) - 1];

export interface StudentRef {
  name: string;
  regNo: string;
  /** "CS Sem 3" */
  className: string;
}

export type MessageData =
  | {
      kind: "WEEKLY_SUMMARY";
      student: StudentRef;
      weekFrom: IsoDate;
      weekTo: IsoDate;
      attended: number;
      counted: number;
      /** Missed classes this week: subject short name + the dates missed. */
      missed: { subject: string; dates: IsoDate[] }[];
      /** Term-to-date overall %, already formatted ("82.4%"). */
      overall: string;
      minPct: number;
      /** Subjects below the minimum (term to date), formatted "MATHS 52.3%". */
      short: string[];
      link: string | null;
    }
  | { kind: "ATTENDANCE_WARNING" | "ATTENDANCE_SHORTAGE"; student: StudentRef; subjects: string[]; minPct: number; warnPct: number; link: string | null }
  | { kind: "CONSECUTIVE_ABSENCE"; student: StudentRef; days: number; from: IsoDate; to: IsoDate }
  | { kind: "DAY_ABSENCE"; student: StudentRef; date: IsoDate }
  | { kind: "LEAVE_RECORDED"; student: StudentRef; leaveType: "MEDICAL" | "ON_DUTY" | "PERSONAL" | "OTHER"; from: IsoDate; to: IsoDate }
  | { kind: "BROADCAST"; textEn: string; textKn: string }
  /** Stored with the code masked; the real code only goes to the provider. */
  | { kind: "LOGIN_OTP"; code: string; minutes: number }
  | {
      kind: "MARKS_PUBLISHED" | "LOW_MARKS";
      student: StudentRef;
      subject: string;
      /** Scheme part code (CIE_T1, CIE_P2, ACT, SEE) — the Kannada label is derived from it. */
      partCode: string;
      partLabel: string;
      /** "38.5", or the flag "AB" / "MP". */
      mark: string;
      maxMarks: string;
      /** Internal marks so far from published parts, e.g. "38.4", and what it is out of. */
      cieSoFar: string | null;
      cieOutOf: number;
      link: string | null;
    };

const LEAVE_EN = { MEDICAL: "Medical leave", ON_DUTY: "On-duty (OD)", PERSONAL: "Personal leave", OTHER: "Leave" } as const;
const LEAVE_KN = { MEDICAL: "ವೈದ್ಯಕೀಯ ರಜೆ", ON_DUTY: "ಆನ್-ಡ್ಯೂಟಿ (OD)", PERSONAL: "ವೈಯಕ್ತಿಕ ರಜೆ", OTHER: "ರಜೆ" } as const;

/** Kannada name of a marks part, from its code. */
export function partLabelKn(code: string, labelEn: string): string {
  const n = code.match(/(\d)$/)?.[1] ?? "";
  if (code.startsWith("CIE_T")) return `ಸಿದ್ಧಾಂತ ಪರೀಕ್ಷೆ ${n}`;
  if (code.startsWith("CIE_P")) return `ಪ್ರಾಯೋಗಿಕ ಪರೀಕ್ಷೆ ${n}`;
  if (code === "ACT") return "ಚಟುವಟಿಕೆ";
  if (code === "SEE") return /practical/i.test(labelEn) ? "ಅಂತಿಮ ಪ್ರಾಯೋಗಿಕ ಪರೀಕ್ಷೆ" : "ಅಂತಿಮ ಸಿದ್ಧಾಂತ ಪರೀಕ್ಷೆ";
  return labelEn;
}

const markEn = (m: string) => (m === "AB" ? "Absent" : m === "MP" ? "Malpractice (0)" : m);
const markKn = (m: string) => (m === "AB" ? "ಗೈರು" : m === "MP" ? "ಪರೀಕ್ಷಾ ಅಕ್ರಮ (0)" : m);

const who = (s: StudentRef) => `${s.name} (${s.regNo}), ${s.className}`;
const range = (from: IsoDate, to: IsoDate, f: (d: IsoDate) => string) => (from === to ? f(from) : `${f(from)} – ${f(to)}`);

function english(d: MessageData): string {
  switch (d.kind) {
    case "WEEKLY_SUMMARY": {
      const missed = d.missed.length ? d.missed.map((m) => `${m.subject} (${m.dates.map(dayEn).join(", ")})`).join(", ") : "None";
      return lines(
        `${COLLEGE_EN} – Weekly attendance`,
        `Week: ${range(d.weekFrom, d.weekTo, formatDateShort)}`,
        `Student: ${who(d.student)}`,
        `This week: ${d.attended} of ${d.counted} classes attended`,
        `Missed: ${missed}`,
        `Overall this term: ${d.overall} (minimum ${d.minPct}%)`,
        d.short.length ? `Below ${d.minPct}%: ${d.short.join(", ")}` : null,
        d.link ? `Details: ${d.link}` : null,
      );
    }
    case "ATTENDANCE_SHORTAGE":
      return lines(
        `${COLLEGE_EN} – Attendance alert`,
        `${who(d.student)} has attendance below the required ${d.minPct}% in: ${d.subjects.join(", ")}.`,
        `Students below ${d.minPct}% may not be allowed to write the final exam. Please make sure they attend every class.`,
        d.link ? `Details: ${d.link}` : null,
      );
    case "ATTENDANCE_WARNING":
      return lines(
        `${COLLEGE_EN} – Attendance warning`,
        `${who(d.student)} has attendance below ${d.warnPct}% in: ${d.subjects.join(", ")}. The minimum required is ${d.minPct}%.`,
        d.link ? `Details: ${d.link}` : null,
      );
    case "CONSECUTIVE_ABSENCE":
      return lines(
        `${COLLEGE_EN} – Absence alert`,
        `${who(d.student)} has been absent for ${d.days} working days in a row (${range(d.from, d.to, formatDateShort)}).`,
        "If you did not know about this, please contact the class teacher.",
      );
    case "DAY_ABSENCE":
      return lines(`${COLLEGE_EN}`, `${who(d.student)} was absent from all classes on ${dayEn(d.date)}, ${formatDateShort(d.date)}.`);
    case "LEAVE_RECORDED":
      return lines(`${COLLEGE_EN}`, `${LEAVE_EN[d.leaveType]} recorded for ${who(d.student)}: ${range(d.from, d.to, formatDateShort)}.`);
    case "BROADCAST":
      return lines(`${COLLEGE_EN} – Notice`, d.textEn);
    case "LOGIN_OTP":
      return lines(`${COLLEGE_EN} – Parent portal`, `Your login code is ${d.code}. It is valid for ${d.minutes} minutes.`, "Do not share this code with anyone, not even college staff.");
    case "MARKS_PUBLISHED":
      return lines(
        `${COLLEGE_EN} – Marks`,
        `Student: ${who(d.student)}`,
        `${d.subject}, ${d.partLabel}: ${markEn(d.mark)}${d.mark === "AB" || d.mark === "MP" ? "" : ` out of ${d.maxMarks}`}`,
        d.cieSoFar ? `Internal marks so far: ${d.cieSoFar} out of ${d.cieOutOf}` : null,
        d.link ? `Details: ${d.link}` : null,
      );
    case "LOW_MARKS":
      return lines(
        `${COLLEGE_EN} – Low marks`,
        `${who(d.student)} got ${d.mark === "AB" || d.mark === "MP" ? markEn(d.mark) : `${d.mark} out of ${d.maxMarks}`} in ${d.subject}, ${d.partLabel}.`,
        d.cieSoFar ? `Internal marks so far: ${d.cieSoFar} out of ${d.cieOutOf}` : null,
        "Please make sure they prepare well for the next test. You may contact the subject teacher.",
        d.link ? `Details: ${d.link}` : null,
      );
  }
}

function kannada(d: MessageData): string {
  switch (d.kind) {
    case "WEEKLY_SUMMARY": {
      const missed = d.missed.length ? d.missed.map((m) => `${m.subject} (${m.dates.map(dayKn).join(", ")})`).join(", ") : "ಇಲ್ಲ";
      return lines(
        `${COLLEGE_KN} – ವಾರದ ಹಾಜರಾತಿ`,
        `ವಾರ: ${range(d.weekFrom, d.weekTo, formatDateKn)}`,
        `ವಿದ್ಯಾರ್ಥಿ: ${who(d.student)}`,
        `ಈ ವಾರ: ${d.counted} ತರಗತಿಗಳಲ್ಲಿ ${d.attended} ಹಾಜರು`,
        `ಗೈರು: ${missed}`,
        `ಈ ಅವಧಿಯ ಒಟ್ಟು ಹಾಜರಾತಿ: ${d.overall} (ಕನಿಷ್ಠ ${d.minPct}%)`,
        d.short.length ? `${d.minPct}% ಕ್ಕಿಂತ ಕಡಿಮೆ: ${d.short.join(", ")}` : null,
        d.link ? `ವಿವರಗಳು: ${d.link}` : null,
      );
    }
    case "ATTENDANCE_SHORTAGE":
      return lines(
        `${COLLEGE_KN} – ಹಾಜರಾತಿ ಎಚ್ಚರಿಕೆ`,
        `${who(d.student)} ಅವರ ಹಾಜರಾತಿ ಈ ವಿಷಯಗಳಲ್ಲಿ ಅಗತ್ಯವಿರುವ ${d.minPct}% ಕ್ಕಿಂತ ಕಡಿಮೆ ಇದೆ: ${d.subjects.join(", ")}.`,
        `${d.minPct}% ಕ್ಕಿಂತ ಕಡಿಮೆ ಹಾಜರಾತಿ ಇರುವವರಿಗೆ ಅಂತಿಮ ಪರೀಕ್ಷೆ ಬರೆಯಲು ಅವಕಾಶ ಸಿಗದಿರಬಹುದು. ದಯವಿಟ್ಟು ಎಲ್ಲಾ ತರಗತಿಗಳಿಗೆ ಹಾಜರಾಗುವಂತೆ ನೋಡಿಕೊಳ್ಳಿ.`,
        d.link ? `ವಿವರಗಳು: ${d.link}` : null,
      );
    case "ATTENDANCE_WARNING":
      return lines(
        `${COLLEGE_KN} – ಹಾಜರಾತಿ ಸೂಚನೆ`,
        `${who(d.student)} ಅವರ ಹಾಜರಾತಿ ಈ ವಿಷಯಗಳಲ್ಲಿ ${d.warnPct}% ಕ್ಕಿಂತ ಕಡಿಮೆಯಾಗಿದೆ: ${d.subjects.join(", ")}. ಕನಿಷ್ಠ ಅಗತ್ಯ ${d.minPct}%.`,
        d.link ? `ವಿವರಗಳು: ${d.link}` : null,
      );
    case "CONSECUTIVE_ABSENCE":
      return lines(
        `${COLLEGE_KN} – ಗೈರುಹಾಜರಿ ಎಚ್ಚರಿಕೆ`,
        `${who(d.student)} ಅವರು ಸತತ ${d.days} ಕೆಲಸದ ದಿನಗಳಿಂದ (${range(d.from, d.to, formatDateKn)}) ಗೈರಾಗಿದ್ದಾರೆ.`,
        "ಇದು ನಿಮಗೆ ತಿಳಿದಿಲ್ಲದಿದ್ದರೆ, ದಯವಿಟ್ಟು ತರಗತಿ ಶಿಕ್ಷಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      );
    case "DAY_ABSENCE":
      return lines(`${COLLEGE_KN}`, `${who(d.student)} ಅವರು ${formatDateKn(d.date)} (${dayKn(d.date)}) ರಂದು ಎಲ್ಲಾ ತರಗತಿಗಳಿಗೆ ಗೈರಾಗಿದ್ದರು.`);
    case "LEAVE_RECORDED":
      return lines(`${COLLEGE_KN}`, `${who(d.student)} ಅವರಿಗೆ ${range(d.from, d.to, formatDateKn)} ${LEAVE_KN[d.leaveType]} ದಾಖಲಿಸಲಾಗಿದೆ.`);
    case "BROADCAST":
      return lines(`${COLLEGE_KN} – ಸೂಚನೆ`, d.textKn);
    case "LOGIN_OTP":
      return lines(`${COLLEGE_KN} – ಪೋಷಕರ ಪೋರ್ಟಲ್`, `ನಿಮ್ಮ ಲಾಗಿನ್ ಕೋಡ್ ${d.code}. ಇದು ${d.minutes} ನಿಮಿಷ ಮಾನ್ಯವಾಗಿರುತ್ತದೆ.`, "ಈ ಕೋಡ್ ಅನ್ನು ಕಾಲೇಜು ಸಿಬ್ಬಂದಿ ಸೇರಿದಂತೆ ಯಾರೊಂದಿಗೂ ಹಂಚಿಕೊಳ್ಳಬೇಡಿ.");
    case "MARKS_PUBLISHED":
      return lines(
        `${COLLEGE_KN} – ಅಂಕಗಳು`,
        `ವಿದ್ಯಾರ್ಥಿ: ${who(d.student)}`,
        `${d.subject}, ${partLabelKn(d.partCode, d.partLabel)}: ${d.mark === "AB" || d.mark === "MP" ? markKn(d.mark) : `${d.maxMarks} ರಲ್ಲಿ ${d.mark}`}`,
        d.cieSoFar ? `ಇಲ್ಲಿಯವರೆಗಿನ ಆಂತರಿಕ ಅಂಕಗಳು: ${d.cieOutOf} ರಲ್ಲಿ ${d.cieSoFar}` : null,
        d.link ? `ವಿವರಗಳು: ${d.link}` : null,
      );
    case "LOW_MARKS":
      return lines(
        `${COLLEGE_KN} – ಕಡಿಮೆ ಅಂಕಗಳು`,
        `${who(d.student)} ಅವರು ${d.subject}, ${partLabelKn(d.partCode, d.partLabel)} ನಲ್ಲಿ ${d.mark === "AB" || d.mark === "MP" ? markKn(d.mark) : `${d.maxMarks} ರಲ್ಲಿ ${d.mark} ಅಂಕ ಪಡೆದಿದ್ದಾರೆ`}.`,
        d.cieSoFar ? `ಇಲ್ಲಿಯವರೆಗಿನ ಆಂತರಿಕ ಅಂಕಗಳು: ${d.cieOutOf} ರಲ್ಲಿ ${d.cieSoFar}` : null,
        "ಮುಂದಿನ ಪರೀಕ್ಷೆಗೆ ಚೆನ್ನಾಗಿ ತಯಾರಾಗುವಂತೆ ದಯವಿಟ್ಟು ನೋಡಿಕೊಳ್ಳಿ. ವಿಷಯ ಶಿಕ್ಷಕರನ್ನು ಸಂಪರ್ಕಿಸಬಹುದು.",
        d.link ? `ವಿವರಗಳು: ${d.link}` : null,
      );
  }
}

function lines(...ls: (string | null)[]) {
  return ls.filter((l): l is string => l !== null && l !== "").join("\n");
}

/** Full WhatsApp text in the contact's language (both = English, blank line, Kannada). */
export function renderWhatsApp(d: MessageData, lang: Language): string {
  const en = lang === "KN" ? "" : english(d);
  const kn = lang === "EN" ? "" : kannada(d);
  if ((lang !== "KN" && !en) || (lang !== "EN" && !kn)) throw new Error(`No message text for kind "${(d as { kind?: unknown }).kind}"`);
  return lang === "BOTH" ? `${en}\n\n${kn}` : en || kn;
}

/**
 * SMS text: one short line (SMS costs per segment, Kannada is Unicode = 70 chars a segment).
 * Kannada only when the parent asked for Kannada only.
 */
export function renderSms(d: MessageData, lang: Language): string {
  const text = sms(d, lang);
  if (!text) throw new Error(`No SMS text for kind "${(d as { kind?: unknown }).kind}"`);
  return text;
}

function sms(d: MessageData, lang: Language): string | undefined {
  const kn = lang === "KN";
  const s = "student" in d ? d.student : null;
  const name = s ? `${s.name} ${s.regNo}` : "";
  switch (d.kind) {
    case "WEEKLY_SUMMARY":
      return kn
        ? `MEI: ${name} ಈ ವಾರ ${d.counted} ರಲ್ಲಿ ${d.attended} ಹಾಜರು, ಒಟ್ಟು ${d.overall}.${d.link ? ` ${d.link}` : ""}`
        : `MEI Poly: ${name} attended ${d.attended}/${d.counted} classes this week. Overall ${d.overall}.${d.link ? ` ${d.link}` : ""}`;
    case "ATTENDANCE_SHORTAGE":
      return kn
        ? `MEI: ${name} ಹಾಜರಾತಿ ${d.minPct}% ಕ್ಕಿಂತ ಕಡಿಮೆ (${d.subjects.length} ವಿಷಯ).${d.link ? ` ${d.link}` : ""}`
        : `MEI Poly: ${name} attendance below ${d.minPct}% in ${d.subjects.length} subject${d.subjects.length === 1 ? "" : "s"}. May not be allowed to write exams.${d.link ? ` ${d.link}` : ""}`;
    case "ATTENDANCE_WARNING":
      return kn ? `MEI: ${name} ಹಾಜರಾತಿ ${d.warnPct}% ಕ್ಕಿಂತ ಕಡಿಮೆ.` : `MEI Poly: ${name} attendance below ${d.warnPct}% in ${d.subjects.length} subject${d.subjects.length === 1 ? "" : "s"}.`;
    case "CONSECUTIVE_ABSENCE":
      return kn ? `MEI: ${name} ಸತತ ${d.days} ದಿನ ಗೈರು. ತರಗತಿ ಶಿಕ್ಷಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.` : `MEI Poly: ${name} absent ${d.days} days in a row from ${formatDateShort(d.from)}. Please contact the class teacher.`;
    case "DAY_ABSENCE":
      return kn ? `MEI: ${name} ${formatDateKn(d.date)} ರಂದು ಗೈರು.` : `MEI Poly: ${name} absent all day on ${formatDateShort(d.date)}.`;
    case "LEAVE_RECORDED":
      return kn ? `MEI: ${name} ${LEAVE_KN[d.leaveType]} ದಾಖಲು.` : `MEI Poly: ${LEAVE_EN[d.leaveType]} recorded for ${name}, ${range(d.from, d.to, formatDateShort)}.`;
    case "BROADCAST":
      return kn ? `MEI: ${d.textKn}` : `MEI Poly: ${d.textEn}`;
    case "LOGIN_OTP":
      return kn ? `MEI: ನಿಮ್ಮ ಲಾಗಿನ್ ಕೋಡ್ ${d.code}. ಯಾರಿಗೂ ಹೇಳಬೇಡಿ.` : `MEI Poly parent portal code: ${d.code}. Valid ${d.minutes} min. Do not share it with anyone.`;
    case "MARKS_PUBLISHED":
    case "LOW_MARKS": {
      const m = d.mark === "AB" || d.mark === "MP" ? (kn ? markKn(d.mark) : markEn(d.mark)) : `${d.mark}/${d.maxMarks}`;
      return kn ? `MEI: ${name} ${d.subject} ${partLabelKn(d.partCode, d.partLabel)}: ${m}` : `MEI Poly: ${name} ${d.subject} ${d.partLabel}: ${m}.${d.cieSoFar ? ` Internal so far ${d.cieSoFar}/${d.cieOutOf}.` : ""}`;
    }
  }
}

/** Group missed classes by subject, dates in order, for the weekly summary. */
export function groupMissed(missed: readonly { subject: string; date: IsoDate }[]): { subject: string; dates: IsoDate[] }[] {
  const by = new Map<string, Set<IsoDate>>();
  for (const m of missed) {
    const set = by.get(m.subject) ?? new Set<IsoDate>();
    set.add(m.date);
    by.set(m.subject, set);
  }
  return [...by.entries()].map(([subject, dates]) => ({ subject, dates: [...dates].sort() })).sort((a, b) => a.subject.localeCompare(b.subject));
}
