import type { ResolvedDay } from "./calendar";
import type { IsoDate } from "./dates";

export type Component = "THEORY" | "PRACTICAL";
export type BatchScope = "ALL" | "B1" | "B2";

export interface SlotDef {
  id: number;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  kind: "CLASS" | "ACTIVITY";
  offeringId: number | null;
  component: Component | null;
  batchScope: BatchScope;
}

export interface VersionDef {
  id: number;
  effectiveFrom: IsoDate;
  slots: readonly SlotDef[];
}

export interface PlannedSession {
  slotId: number;
  offeringId: number;
  component: Component;
  batchScope: BatchScope;
  date: IsoDate;
  startPeriod: number;
  endPeriod: number;
}

/** The timetable version in force on `date`: latest effective_from on or before it. */
export function activeVersion<V extends { effectiveFrom: IsoDate }>(versions: readonly V[], date: IsoDate): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  }
  return best;
}

/**
 * Sessions a class should have on one day. Pure: same inputs, same output — so nightly
 * generation can run any number of times (DB also enforces UNIQUE(slot_id, date)).
 * Activity periods never produce sessions (no subject to attach attendance to).
 */
export function planSessionsForDay(day: ResolvedDay, versions: readonly VersionDef[]): PlannedSession[] {
  if (!day.classesRun || day.timetableWeekday === null) return [];
  const version = activeVersion(versions, day.date);
  if (!version) return [];
  return version.slots
    .filter((s) => s.weekday === day.timetableWeekday && s.kind === "CLASS")
    .map((s) => ({
      slotId: s.id,
      offeringId: s.offeringId!,
      component: s.component!,
      batchScope: s.batchScope,
      date: day.date,
      startPeriod: s.startPeriod,
      endPeriod: s.endPeriod,
    }));
}

export type CourseKind = "INTEGRATED" | "THEORY_ONLY" | "PRACTICAL_ONLY" | "SPECIALIZATION";

/** Which parts (theory / lab) a subject of this kind can have in the timetable and teaching assignments. */
export function allowedComponents(kind: CourseKind): Component[] {
  switch (kind) {
    case "THEORY_ONLY":
      return ["THEORY"];
    case "PRACTICAL_ONLY":
      return ["PRACTICAL"];
    default:
      return ["THEORY", "PRACTICAL"];
  }
}

/**
 * A timetable version may be edited only while no class has been recorded against it.
 * Once attendance exists, changes must go into a new version so history stays exact.
 */
export function isVersionEditable(v: { effectiveFrom: IsoDate }, today: IsoDate, sessionsRecorded: number): boolean {
  return v.effectiveFrom > today || sessionsRecorded === 0;
}

export interface SlotConflict {
  a: SlotDef;
  b: SlotDef;
  reason: string;
}

function scopesClash(a: BatchScope, b: BatchScope): boolean {
  return a === "ALL" || b === "ALL" || a === b;
}

/** Same group of students cannot be in two places at once. Run on every timetable save. */
export function findSlotConflicts(slots: readonly SlotDef[]): SlotConflict[] {
  const conflicts: SlotConflict[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.weekday !== b.weekday) continue;
      const overlap = a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
      if (overlap && scopesClash(a.batchScope, b.batchScope)) {
        conflicts.push({ a, b, reason: `Weekday ${a.weekday}: periods ${a.startPeriod}-${a.endPeriod} and ${b.startPeriod}-${b.endPeriod} overlap for ${a.batchScope}/${b.batchScope}` });
      }
    }
  }
  return conflicts;
}
