export async function persistScan<T>(records: T[], writeBatch: (batch: T[]) => Promise<{ inserted: number; error: string | null }>, deadline: number) {
  let inserted = 0;
  for (let offset = 0; offset < records.length; offset += 200) {
    // Each batch needs a duplicate read and write, each capped at eight seconds.
    if (deadline - Date.now() < 17_000) return { inserted, error: `Saved ${inserted}; save budget reached. Remaining findings are not saved; refresh before retrying.` };
    try {
      const result = await writeBatch(records.slice(offset, offset + 200));
      inserted += result.inserted;
      if (result.error) return { inserted, error: result.error };
    } catch {
      return { inserted, error: `Saved ${inserted}; a later batch could not be confirmed. Refresh before retrying.` };
    }
  }
  return { inserted, error: null };
}