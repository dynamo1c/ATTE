import { describe, expect, it } from "vitest";
import {
  absenceStreak,
  weeklyWindow,
  alertStanding,
  attendanceAlert,
  chooseRecipients,
  istInstant,
  istParts,
  retryDelayMinutes,
  sendableAt,
  type ContactFact,
} from "./rules";

const c = (p: Partial<ContactFact> & Pick<ContactFact, "id">): ContactFact => ({
  phone: `+9198450000${String(p.id).padStart(2, "0")}`,
  language: "BOTH",
  whatsappOk: true,
  consentAt: "2026-06-01T00:00:00Z",
  optedOutAt: null,
  ...p,
});

describe("chooseRecipients", () => {
  it("sends to every consenting parent, WhatsApp or SMS", () => {
    const r = chooseRecipients([c({ id: 1 }), c({ id: 2, whatsappOk: false })], "WEEKLY_SUMMARY");
    expect(r.map((x) => [x.contact.id, x.channel])).toEqual([
      [1, "WHATSAPP"],
      [2, "SMS"],
    ]);
  });

  it("never messages without consent, even for critical alerts", () => {
    expect(chooseRecipients([c({ id: 1, consentAt: null })], "ATTENDANCE_SHORTAGE")).toEqual([]);
  });

  it("opt-out stops updates but not critical alerts", () => {
    const out = c({ id: 1, optedOutAt: "2026-09-01T00:00:00Z" });
    expect(chooseRecipients([out], "WEEKLY_SUMMARY")).toEqual([]);
    expect(chooseRecipients([out], "ATTENDANCE_SHORTAGE")).toHaveLength(1);
  });

  it("the same number saved twice gets one message", () => {
    expect(chooseRecipients([c({ id: 1, phone: "+919845012345" }), c({ id: 2, phone: "+919845012345" })], "WEEKLY_SUMMARY")).toHaveLength(1);
  });
});

describe("quiet hours", () => {
  it("converts India time both ways", () => {
    const t = istInstant("2026-11-01", 18, 30);
    expect(t.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(istParts(t)).toEqual({ date: "2026-11-01", hour: 18, minute: 30 });
  });

  it("moves night messages to 8 am", () => {
    expect(sendableAt(istInstant("2026-11-01", 21, 0), "WEEKLY_SUMMARY").toISOString()).toBe(istInstant("2026-11-02", 8).toISOString());
    expect(sendableAt(istInstant("2026-11-01", 23, 59), "WEEKLY_SUMMARY").toISOString()).toBe(istInstant("2026-11-02", 8).toISOString());
    expect(sendableAt(istInstant("2026-11-02", 2, 0), "ATTENDANCE_SHORTAGE").toISOString()).toBe(istInstant("2026-11-02", 8).toISOString());
    const day = istInstant("2026-11-01", 18, 0);
    expect(sendableAt(day, "WEEKLY_SUMMARY")).toBe(day);
    expect(sendableAt(istInstant("2026-11-01", 20, 59), "WEEKLY_SUMMARY").toISOString()).toBe(istInstant("2026-11-01", 20, 59).toISOString());
  });

  it("never delays a login code", () => {
    const night = istInstant("2026-11-01", 23, 0);
    expect(sendableAt(night, "LOGIN_OTP")).toBe(night);
  });
});

describe("retries", () => {
  it("backs off 1, 4, 16, 64 minutes", () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([1, 4, 16, 64]);
  });
});

describe("attendanceAlert", () => {
  it("alerts once when crossing down, then stays quiet", () => {
    expect(attendanceAlert(null, "AT_RISK")).toEqual({ trigger: "ATTENDANCE_WARNING", remember: "AT_RISK" });
    expect(attendanceAlert("AT_RISK", "AT_RISK")).toEqual({ trigger: null, remember: null });
    expect(attendanceAlert("AT_RISK", "SHORTAGE")).toEqual({ trigger: "ATTENDANCE_SHORTAGE", remember: "SHORTAGE" });
    expect(attendanceAlert(null, "SHORTAGE").trigger).toBe("ATTENDANCE_SHORTAGE");
    expect(attendanceAlert("SHORTAGE", "SHORTAGE").trigger).toBeNull();
  });

  it("recovering is remembered silently so the next drop alerts again", () => {
    expect(attendanceAlert("SHORTAGE", "OK")).toEqual({ trigger: null, remember: "OK" });
    expect(attendanceAlert("OK", "SHORTAGE").trigger).toBe("ATTENDANCE_SHORTAGE");
  });

  it("records a first OK without messaging; ignores no data", () => {
    expect(attendanceAlert(null, "OK")).toEqual({ trigger: null, remember: "OK" });
    expect(attendanceAlert("SHORTAGE", "NO_DATA")).toEqual({ trigger: null, remember: null });
  });
});

describe("alertStanding", () => {
  it("ignores subjects with too few classes", () => {
    expect(alertStanding([{ standing: "SHORTAGE", counted: 3 }, { standing: "OK", counted: 20 }])).toBe("OK");
    expect(alertStanding([{ standing: "SHORTAGE", counted: 8 }, { standing: "OK", counted: 20 }])).toBe("SHORTAGE");
    expect(alertStanding([{ standing: "AT_RISK", counted: 2 }])).toBe("NO_DATA");
  });
});

describe("absenceStreak", () => {
  const d = (date: string, marked: number, attended: number, unmarked = 0) => ({ date, marked, attended, unmarked });
  it("counts whole days absent up to the latest entered day", () => {
    expect(absenceStreak([d("2026-10-26", 5, 5), d("2026-10-27", 5, 0), d("2026-10-28", 4, 0), d("2026-10-29", 5, 0)])).toEqual({ from: "2026-10-27", to: "2026-10-29", days: 3 });
  });

  it("a day with any class attended breaks the run", () => {
    expect(absenceStreak([d("2026-10-27", 5, 0), d("2026-10-28", 5, 1)])).toBeNull();
  });

  it("holidays and unentered days neither break nor extend it", () => {
    expect(absenceStreak([d("2026-10-30", 5, 0), d("2026-10-31", 0, 0), d("2026-11-01", 0, 0), d("2026-11-02", 5, 0)])).toEqual({ from: "2026-10-30", to: "2026-11-02", days: 2 });
  });

  it("a partly entered day is unknown: it neither counts as absent nor breaks the run", () => {
    expect(absenceStreak([d("2026-10-27", 5, 0), d("2026-10-28", 3, 0, 2), d("2026-10-29", 5, 0)])).toEqual({ from: "2026-10-27", to: "2026-10-29", days: 2 });
    expect(absenceStreak([d("2026-10-29", 0, 0, 5)])).toBeNull();
  });

  it("works on unsorted input and empty input", () => {
    expect(absenceStreak([d("2026-10-29", 5, 0), d("2026-10-28", 5, 0)])?.days).toBe(2);
    expect(absenceStreak([])).toBeNull();
  });
});

describe("weeklyWindow", () => {
  it("covers Mon–Sat from Sunday 5 pm", () => {
    expect(weeklyWindow(istInstant("2026-11-01", 16, 59))).toBeNull();
    expect(weeklyWindow(istInstant("2026-11-01", 17, 0))).toEqual({ from: "2026-10-26", to: "2026-10-31" });
    expect(weeklyWindow(istInstant("2026-11-01", 23, 0))).toEqual({ from: "2026-10-26", to: "2026-10-31" });
  });

  it("catches up on Monday if Sunday's run was missed, but never sends a stale week", () => {
    expect(weeklyWindow(istInstant("2026-11-02", 9, 0))).toEqual({ from: "2026-10-26", to: "2026-10-31" });
    expect(weeklyWindow(istInstant("2026-11-03", 9, 0))).toBeNull();
    expect(weeklyWindow(istInstant("2026-11-05", 12, 0))).toBeNull();
  });
});
