/** Reciprocal Rank Fusion: merges several ranked id lists into one ordering. */
export function fuseRanks(lists: string[][], k = 60, weights?: number[]): string[] {
  const score = new Map<string, number>();
  lists.forEach((list, li) => {
    const w = weights?.[li] ?? 1;
    const seen = new Set<string>();
    list.forEach((id, rank) => {
      if (seen.has(id)) return;
      seen.add(id);
      score.set(id, (score.get(id) ?? 0) + w / (k + rank + 1));
    });
  });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Nominal battery energy in kWh from voltage and amp-hours. */
export function batteryKwh(volts: number, ah: number): number {
  return Math.round(((volts * ah) / 1000) * 100) / 100;
}
