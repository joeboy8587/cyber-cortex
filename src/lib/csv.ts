/**
 * RFC 4180 compliant CSV writer.
 *
 * Forensic exports must never shift columns. Unquoted commas inside text
 * fields (flagged_reasons, owner_operator, …) previously pushed coordinates
 * into the county column of exported files. Every field is quoted, embedded
 * quotes are doubled, and the column count is asserted on every row.
 */

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  // strip characters that break line alignment in naive parsers
  s = s.replace(/\r\n|\r/g, "\n");
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[], expectedColumns?: number): string {
  if (expectedColumns !== undefined && values.length !== expectedColumns) {
    throw new Error(
      `CSV column count mismatch: expected ${expectedColumns}, got ${values.length}`,
    );
  }
  return values.map(csvField).join(",");
}

/** Build a full CSV document from records. Column set is fixed by `headers`. */
export function toCSV(
  rows: Record<string, unknown>[],
  headers?: string[],
): string {
  const cols =
    headers ??
    Array.from(rows.reduce<Set<string>>((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()));

  const lines = [csvRow(cols, cols.length)];
  for (const row of rows) {
    lines.push(csvRow(cols.map((c) => row[c] ?? null), cols.length));
  }
  return lines.join("\r\n");
}

/** Trigger a browser download using the forensic naming convention. */
export function downloadCSV(
  rows: Record<string, unknown>[],
  filename: string,
  headers?: string[],
): void {
  const blob = new Blob(["\uFEFF" + toCSV(rows, headers)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** YYYYMMDD_CASE_EXHIBIT_FILENAME convention. */
export function forensicFilename(exhibit: string, name: string, ext = "csv"): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${d}_WATCHTOWER_${exhibit}_${name}.${ext}`;
}
