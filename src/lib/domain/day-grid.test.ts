import { describe, expect, it } from "vitest";
import { dayBlocks, rowSlots } from "./day-grid";

const s = (id: string, startPeriod: number, endPeriod = startPeriod) => ({ id, startPeriod, endPeriod });

describe("dayBlocks", () => {
  it("puts parallel batches in one cell and keeps separate periods apart", () => {
    const blocks = dayBlocks([s("CN B1", 1), s("DC&T B2", 1), s("S&NA B1", 3), s("DSP B2", 3)]);
    expect(blocks.map((b) => [b.from, b.to, b.sessions.map((x) => x.id)])).toEqual([
      [1, 1, ["CN B1", "DC&T B2"]],
      [3, 3, ["S&NA B1", "DSP B2"]],
    ]);
  });

  it("a lab spanning periods takes the classes that overlap it", () => {
    const blocks = dayBlocks([s("FEEE B2", 2), s("IT lab B1", 1, 2), s("BDLCO", 4)]);
    expect(blocks.map((b) => [b.from, b.to, b.sessions.map((x) => x.id)])).toEqual([
      [1, 2, ["IT lab B1", "FEEE B2"]],
      [4, 4, ["BDLCO"]],
    ]);
  });

  it("a full-morning specialization is one cell", () => {
    expect(dayBlocks([s("SPEC", 1, 4)])).toEqual([{ from: 1, to: 4, sessions: [s("SPEC", 1, 4)] }]);
    expect(dayBlocks([])).toEqual([]);
  });
});

describe("rowSlots", () => {
  const periods = [1, 2, 3, 4, 5, 6, 7];
  it("marks spans, covered periods and empty ones", () => {
    const slots = rowSlots(periods, dayBlocks([s("lab", 1, 2), s("x", 4), s("y", 5, 7)]));
    expect(slots.map((x) => (x.kind === "block" ? `block${x.span}` : x.kind))).toEqual(["block2", "covered", "empty", "block1", "block3", "covered", "covered"]);
  });
});
