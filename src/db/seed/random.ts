/** Deterministic PRNG (mulberry32): the same seed always produces the same dummy data. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    range: (min: number, max: number) => min + next() * (max - min),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    /** Approximately normal via Box–Muller. */
    normal: (mean: number, sd: number) => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
