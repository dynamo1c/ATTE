/**
 * Lays one day's classes out like the printed timetable: one row per class, one column per period.
 * Sessions that overlap (B1 and B2 in parallel, a 2-period lab next to a 1-period class) share one cell,
 * which spans from the earliest start to the latest end among them.
 */

export interface GridSession {
  startPeriod: number;
  endPeriod: number;
}

export interface GridBlock<S extends GridSession> {
  /** First and last period the cell covers (inclusive). */
  from: number;
  to: number;
  /** Sessions in the cell, by start period (then as given). */
  sessions: S[];
}

/** Group a class's sessions for one day into cells. Input in any order; output by period. */
export function dayBlocks<S extends GridSession>(sessions: readonly S[]): GridBlock<S>[] {
  const sorted = [...sessions].sort((a, b) => a.startPeriod - b.startPeriod || a.endPeriod - b.endPeriod);
  const blocks: GridBlock<S>[] = [];
  for (const s of sorted) {
    const last = blocks.at(-1);
    if (last && s.startPeriod <= last.to) {
      last.sessions.push(s);
      last.to = Math.max(last.to, s.endPeriod);
    } else {
      blocks.push({ from: s.startPeriod, to: s.endPeriod, sessions: [s] });
    }
  }
  return blocks;
}

/**
 * What goes in each period slot of a row: the block starting there, "covered" by a block that started
 * earlier, or "empty". `periods` are the period ordinals in order.
 */
export type Slot<S extends GridSession> = { kind: "block"; block: GridBlock<S>; span: number } | { kind: "covered" } | { kind: "empty" };

export function rowSlots<S extends GridSession>(periods: readonly number[], blocks: readonly GridBlock<S>[]): Slot<S>[] {
  const byStart = new Map(blocks.map((b) => [b.from, b]));
  const slots: Slot<S>[] = [];
  let coveredUntil = -Infinity;
  for (const p of periods) {
    const b = byStart.get(p);
    if (b) {
      // Span counts only periods that exist in the grid (a block never crosses lunch in practice).
      const span = periods.filter((q) => q >= b.from && q <= b.to).length;
      slots.push({ kind: "block", block: b, span });
      coveredUntil = b.to;
    } else if (p <= coveredUntil) {
      slots.push({ kind: "covered" });
    } else {
      slots.push({ kind: "empty" });
    }
  }
  return slots;
}
