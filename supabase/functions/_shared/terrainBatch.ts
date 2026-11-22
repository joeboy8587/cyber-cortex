export type TerrainPoint = { lat: number; lon: number };
export const TERRAIN_BATCH = { concurrency: 8, budgetMs: 20_000, requestMs: 4_000 };
export const terrainKey = ({ lat, lon }: TerrainPoint) => `${lat},${lon}`;
export function validPoint(p: TerrainPoint) {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
export function elevationValue(value: unknown): number | null {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > -1000 && n < 30_000 ? n : null;
}
// One request per exact coordinate, limited workers, one shared wall-clock budget.
// Failures remain unknown; no permanent negative cache and no approximate terrain cells.
export async function prepareTerrain(points: TerrainPoint[], options: {
  lookup: (p: TerrainPoint, signal: AbortSignal) => Promise<number | null>;
  concurrency?: number; budgetMs?: number; requestMs?: number;
}) {
  const unique = [...new Map(points.filter(validPoint).map(p => [terrainKey(p), p])).values()];
  const values = new Map<string, number | null>();
  const deadline = Date.now() + (options.budgetMs ?? TERRAIN_BATCH.budgetMs);
  let cursor = 0, attempted = 0;
  await Promise.all(Array.from({ length: Math.min(unique.length, options.concurrency ?? TERRAIN_BATCH.concurrency) }, async () => {
    while (cursor < unique.length && Date.now() < deadline) {
      const p = unique[cursor++];
      if (!p) break;
      attempted++;
      const controller = new AbortController();
      const ms = Math.max(1, Math.min(options.requestMs ?? TERRAIN_BATCH.requestMs, deadline - Date.now()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, ms); });
        const value = await Promise.race([options.lookup(p, controller.signal).catch(() => null), timeout]);
        values.set(terrainKey(p), elevationValue(value));
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
    }
  }));
  for (const p of unique) if (!values.has(terrainKey(p))) values.set(terrainKey(p), null);
  return { values, unique: unique.length, attempted,
    resolved: [...values.values()].filter(v => v != null).length,
    deferred: unique.length - attempted, budgetMs: options.budgetMs ?? TERRAIN_BATCH.budgetMs };
}
