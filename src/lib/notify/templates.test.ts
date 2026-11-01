import { describe, expect, it } from "vitest";
import { formatDateKn, groupMissed, renderSms, renderWhatsApp, type MessageData } from "./templates";

const student = { name: "Rahul K", regNo: "204CS25012", className: "CS Sem 3" };
const weekly: MessageData = {
  kind: "WEEKLY_SUMMARY",
  student,
  weekFrom: "2026-10-26",
  weekTo: "2026-10-31",
  attended: 26,
  counted: 30,
  missed: [
    { subject: "DSP", dates: ["2026-10-27"] },
    { subject: "KAN", dates: ["2026-10-28", "2026-10-29"] },
  ],
  overall: "82.0%",
  minPct: 60,
  short: [],
  link: "https://example.test/p",
};

describe("templates", () => {
  it("formats Kannada dates", () => {
    expect(formatDateKn("2026-10-31")).toBe("31 ಅಕ್ಟೋಬರ್ 2026");
    expect(formatDateKn("2026-01-05")).toBe("5 ಜನವರಿ 2026");
  });

  it("weekly summary in English names the week, counts and missed days", () => {
    const t = renderWhatsApp(weekly, "EN");
    expect(t).toContain("MEI Polytechnic – Weekly attendance");
    expect(t).toContain("Student: Rahul K (204CS25012), CS Sem 3");
    expect(t).toContain("This week: 26 of 30 classes attended");
    expect(t).toContain("Missed: DSP (Tue), KAN (Wed, Thu)");
    expect(t).toContain("Overall this term: 82.0% (minimum 60%)");
    expect(t).toContain("Details: https://example.test/p");
    expect(t).not.toContain("Below 60%");
    expect(t).not.toMatch(/[ಀ-೿]/); // no Kannada in the English-only version
  });

  it("both languages = English then Kannada", () => {
    const t = renderWhatsApp(weekly, "BOTH");
    const [en, kn] = t.split("\n\n");
    expect(en).toContain("Weekly attendance");
    expect(kn).toContain("ವಾರದ ಹಾಜರಾತಿ");
    expect(kn).toContain("DSP (ಮಂಗಳ)");
    expect(kn).toContain("30 ತರಗತಿಗಳಲ್ಲಿ 26 ಹಾಜರು");
  });

  it("lists shortage subjects when there are any", () => {
    expect(renderWhatsApp({ ...weekly, short: ["MATHS 52.3%"] }, "EN")).toContain("Below 60%: MATHS 52.3%");
  });

  it("no link line when there is no portal yet", () => {
    expect(renderWhatsApp({ ...weekly, link: null }, "BOTH")).not.toContain("Details");
  });

  it("shortage alert mentions exam eligibility", () => {
    const t = renderWhatsApp({ kind: "ATTENDANCE_SHORTAGE", student, subjects: ["MATHS 52.3%"], minPct: 60, warnPct: 70, link: null }, "EN");
    expect(t).toContain("below the required 60% in: MATHS 52.3%");
    expect(t).toContain("final exam");
  });

  it("every message kind renders in every language without placeholders", () => {
    const all: MessageData[] = [
      weekly,
      { kind: "ATTENDANCE_WARNING", student, subjects: ["IT 64.0%"], minPct: 60, warnPct: 70, link: null },
      { kind: "ATTENDANCE_SHORTAGE", student, subjects: ["IT 54.0%"], minPct: 60, warnPct: 70, link: null },
      { kind: "CONSECUTIVE_ABSENCE", student, days: 3, from: "2026-10-27", to: "2026-10-29" },
      { kind: "DAY_ABSENCE", student, date: "2026-10-29" },
      { kind: "LEAVE_RECORDED", student, leaveType: "ON_DUTY", from: "2026-10-29", to: "2026-10-29" },
      { kind: "BROADCAST", textEn: "College closed tomorrow.", textKn: "ನಾಳೆ ಕಾಲೇಜಿಗೆ ರಜೆ." },
      { kind: "LOGIN_OTP", code: "042913", minutes: 10 },
      { kind: "MARKS_PUBLISHED", student, subject: "DSP", partCode: "CIE_T2", partLabel: "Theory test 2", mark: "38.5", maxMarks: "50", cieSoFar: "40.2", cieOutOf: 50, link: null },
      { kind: "LOW_MARKS", student, subject: "DSP", partCode: "CIE_P1", partLabel: "Practical test 1", mark: "AB", maxMarks: "50", cieSoFar: null, cieOutOf: 50, link: "https://x.test" },
    ];
    for (const d of all)
      for (const lang of ["EN", "KN", "BOTH"] as const) {
        for (const t of [renderWhatsApp(d, lang), renderSms(d, lang)]) {
          expect(t.length).toBeGreaterThan(10);
          expect(t).not.toMatch(/undefined|null|NaN|\$\{/);
        }
      }
  });

  it("login code: in every language and channel, with a do-not-share warning", () => {
    const d = { kind: "LOGIN_OTP", code: "042913", minutes: 10 } as const;
    for (const lang of ["EN", "KN", "BOTH"] as const) {
      expect(renderWhatsApp(d, lang)).toContain("042913");
      expect(renderSms(d, lang)).toContain("042913");
    }
    expect(renderWhatsApp(d, "EN")).toContain("Do not share");
  });

  it("marks messages: value out of max, Kannada part names, AB spelled out", () => {
    const base = { student, subject: "DSP", partCode: "CIE_T2", partLabel: "Theory test 2", mark: "38.5", maxMarks: "50", cieSoFar: "40.2", cieOutOf: 50, link: null } as const;
    const t = renderWhatsApp({ kind: "MARKS_PUBLISHED", ...base }, "BOTH");
    expect(t).toContain("DSP, Theory test 2: 38.5 out of 50");
    expect(t).toContain("Internal marks so far: 40.2 out of 50");
    expect(t).toContain("ಸಿದ್ಧಾಂತ ಪರೀಕ್ಷೆ 2: 50 ರಲ್ಲಿ 38.5");
    const ab = renderWhatsApp({ kind: "LOW_MARKS", ...base, mark: "AB", partCode: "SEE", partLabel: "Final exam (practical)" }, "BOTH");
    expect(ab).toContain("got Absent in DSP, Final exam (practical)");
    expect(ab).toContain("ಅಂತಿಮ ಪ್ರಾಯೋಗಿಕ ಪರೀಕ್ಷೆ ನಲ್ಲಿ ಗೈರು");
    expect(ab).not.toContain("out of 50 in");
  });

  it("an unknown kind throws instead of producing an empty message", () => {
    const bad = { kind: "NOPE" } as unknown as MessageData;
    expect(() => renderWhatsApp(bad, "BOTH")).toThrow();
    expect(() => renderWhatsApp(bad, "EN")).toThrow();
    expect(() => renderSms(bad, "KN")).toThrow();
  });

  it("SMS stays short", () => {
    expect(renderSms(weekly, "BOTH").length).toBeLessThanOrEqual(160);
    expect(renderSms({ kind: "CONSECUTIVE_ABSENCE", student, days: 3, from: "2026-10-27", to: "2026-10-29" }, "EN").length).toBeLessThanOrEqual(160);
  });

  it("groups missed classes by subject", () => {
    expect(
      groupMissed([
        { subject: "MATHS", date: "2026-10-28" },
        { subject: "DSP", date: "2026-10-27" },
        { subject: "MATHS", date: "2026-10-27" },
        { subject: "MATHS", date: "2026-10-28" },
      ]),
    ).toEqual([
      { subject: "DSP", dates: ["2026-10-27"] },
      { subject: "MATHS", dates: ["2026-10-27", "2026-10-28"] },
    ]);
  });
});
