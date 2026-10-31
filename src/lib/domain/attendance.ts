/**
 * Attendance calculation. Pure functions only — every rule here has unit tests.
 *
 * Rules (docs/PLAN.md §5):
 * - One session = one attendance, whatever its length (a 3-hour lab counts once).
 * - A session counts for a student only if it was HELD, the student was a member that day,
 *   and the session's batch (ALL/B1/B2) matches the student's batch that day.
 * - LATE counts as present.
 * - An approved leave covering an ABSENT mark is applied using the leave policy
 *   (PRESENT / EXCUSED = removed from total / ABSENT = still absent, but annotated).
 * - Percentages are computed from totals, never by averaging percentages.
 */
import type { IsoDate } from "./dates";
import type { BatchScope, Component } from "./timetable";

export type Batch = "B1" | "B2";
export type MarkStatus = "PRESENT" | "ABSENT" | "LATE";
export type SessionStatus = "SCHEDULED" | "HELD" | "NOT_HELD" | "CANCELLED";
export type LeaveType = "MEDICAL" | "ON_DUTY" | "PERSONAL" | "OTHER";
export type LeaveCountsAs = "PRESENT" | "EXCUSED" | "ABSENT";
export type LeavePolicy = Record<LeaveType, LeaveCountsAs>;

export interface SessionFact {
  id: number;
  offeringId: number;
  component: Component;
  batchScope: BatchScope;
  date: IsoDate;
  status: SessionStatus;
}

export interface MembershipFact {
  joinedOn: IsoDate;
  leftOn: IsoDate | null;
  batches: readonly { batch: Batch; effectiveFrom: IsoDate }[];
}

export interface LeaveFact {
  type: LeaveType;
  fromDate: IsoDate;
  toDate: IsoDate;
}

export type Outcome =
  | "NOT_APPLICABLE"
  | "UNMARKED"
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "LEAVE_PRESENT"
  | "LEAVE_EXCUSED"
  | "LEAVE_ABSENT";

/** Batch on a date: latest assignment with effective_from on or before it. */
export function batchOn(batches: MembershipFact["batches"], date: IsoDate): Batch | null {
  let best: { batch: Batch; effectiveFrom: IsoDate } | null = null;
  for (const b of batches) {
    if (b.effectiveFrom <= date && (!best || b.effectiveFrom > best.effectiveFrom)) best = b;
  }
  return best?.batch ?? null;
}

/** Whether a session applies to a student at all (ignoring whether it was marked). */
export function sessionAppliesTo(session: SessionFact, membership: MembershipFact): boolean {
  if (session.status === "NOT_HELD" || session.status === "CANCELLED") return false;
  if (session.date < membership.joinedOn) return false;
  if (membership.leftOn !== null && session.date > membership.leftOn) return false;
  if (session.batchScope === "ALL") return true;
  return batchOn(membership.batches, session.date) === session.batchScope;
}

const LEAVE_RANK: Record<LeaveCountsAs, number> = { PRESENT: 3, EXCUSED: 2, ABSENT: 1 };

/** If several approved leaves overlap a date, the most favourable to the student applies. */
export function leaveOn(leaves: readonly LeaveFact[], date: IsoDate, policy: LeavePolicy): LeaveCountsAs | null {
  let best: LeaveCountsAs | null = null;
  for (const l of leaves) {
    if (l.fromDate <= date && date <= l.toDate) {
      const effect = policy[l.type];
      if (!best || LEAVE_RANK[effect] > LEAVE_RANK[best]) best = effect;
    }
  }
  return best;
}

export function evaluateSession(
  session: SessionFact,
  membership: MembershipFact,
  mark: MarkStatus | undefined,
  approvedLeaves: readonly LeaveFact[],
  policy: LeavePolicy,
): Outcome {
  if (!sessionAppliesTo(session, membership)) return "NOT_APPLICABLE";
  if (session.status === "SCHEDULED" || mark === undefined) return "UNMARKED";
  if (mark === "PRESENT") return "PRESENT";
  if (mark === "LATE") return "LATE";
  const leave = leaveOn(approvedLeaves, session.date, policy);
  if (leave === "PRESENT") return "LEAVE_PRESENT";
  if (leave === "EXCUSED") return "LEAVE_EXCUSED";
  if (leave === "ABSENT") return "LEAVE_ABSENT";
  return "ABSENT";
}

export interface Tally {
  /** Sessions that count towards the percentage. */
  counted: number;
  attended: number;
  present: number;
  late: number;
  absent: number;
  /** Absent but covered by leave counted as present (e.g. on-duty). */
  leavePresent: number;
  /** Removed from the total by leave policy. */
  excused: number;
  /** Absent, annotated as on leave. */
  leaveAbsent: number;
  /** Held/scheduled sessions with no mark yet — a data gap, shown to HOD, never counted. */
  unmarked: number;
}

export function emptyTally(): Tally {
  return { counted: 0, attended: 0, present: 0, late: 0, absent: 0, leavePresent: 0, excused: 0, leaveAbsent: 0, unmarked: 0 };
}

export function addOutcome(t: Tally, o: Outcome): void {
  switch (o) {
    case "NOT_APPLICABLE":
      return;
    case "UNMARKED":
      t.unmarked++;
      return;
    case "LEAVE_EXCUSED":
      t.excused++;
      return;
    case "PRESENT":
      t.present++;
      t.attended++;
      break;
    case "LATE":
      t.late++;
      t.attended++;
      break;
    case "LEAVE_PRESENT":
      t.leavePresent++;
      t.attended++;
      break;
    case "ABSENT":
      t.absent++;
      break;
    case "LEAVE_ABSENT":
      t.leaveAbsent++;
      break;
  }
  t.counted++;
}

export function mergeTallies(...tallies: Tally[]): Tally {
  const out = emptyTally();
  for (const t of tallies) for (const k of Object.keys(out) as (keyof Tally)[]) out[k] += t[k];
  return out;
}

/** Exact percentage, or null when nothing has been counted yet. */
export function percent(t: Tally): number | null {
  return t.counted === 0 ? null : (t.attended / t.counted) * 100;
}

export interface OfferingAttendance {
  offeringId: number;
  theory: Tally;
  practical: Tally;
  total: Tally;
}

export interface StudentAttendance {
  byOffering: OfferingAttendance[];
  overall: Tally;
}

export function computeStudentAttendance(input: {
  sessions: readonly SessionFact[];
  membership: MembershipFact;
  marks: ReadonlyMap<number, MarkStatus>;
  approvedLeaves: readonly LeaveFact[];
  policy: LeavePolicy;
}): StudentAttendance {
  const byOffering = new Map<number, OfferingAttendance>();
  for (const s of input.sessions) {
    const outcome = evaluateSession(s, input.membership, input.marks.get(s.id), input.approvedLeaves, input.policy);
    if (outcome === "NOT_APPLICABLE") continue;
    let entry = byOffering.get(s.offeringId);
    if (!entry) {
      entry = { offeringId: s.offeringId, theory: emptyTally(), practical: emptyTally(), total: emptyTally() };
      byOffering.set(s.offeringId, entry);
    }
    addOutcome(s.component === "THEORY" ? entry.theory : entry.practical, outcome);
    addOutcome(entry.total, outcome);
  }
  const list = [...byOffering.values()].sort((a, b) => a.offeringId - b.offeringId);
  return { byOffering: list, overall: mergeTallies(...list.map((o) => o.total)) };
}

export type Standing = "NO_DATA" | "OK" | "AT_RISK" | "SHORTAGE";

export function standing(pct: number | null, minPct: number, warnPct: number): Standing {
  if (pct === null) return "NO_DATA";
  if (pct < minPct) return "SHORTAGE";
  if (pct < warnPct) return "AT_RISK";
  return "OK";
}

/**
 * Display with one decimal, rounded DOWN. Rounding half-up would show 59.96% as "60.0%"
 * while the student is actually short — never acceptable.
 */
export function formatPercent(pct: number | null): string {
  if (pct === null) return "—";
  // Guard against float noise like 66.99999999 → 66.9 by nudging before flooring.
  const floored = Math.floor(pct * 10 + 1e-9) / 10;
  return `${floored.toFixed(1)}%`;
}
