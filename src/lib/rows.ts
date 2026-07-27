export type GenericRow = Record<string, any>;

export function expandJsonRow<T extends GenericRow>(row: T | null | undefined, column = 'related_json'): T | null {
  if (!row) return null;
  const raw = row[column];
  if (typeof raw === 'string' && raw) {
    try { Object.assign(row, JSON.parse(raw)); } catch { /* mantém a linha original */ }
  }
  delete row[column];
  return row;
}

export function expandJsonRows<T extends GenericRow>(rows: T[] | null | undefined, column = 'related_json'): T[] {
  return (rows || []).map(row => expandJsonRow(row, column) as T);
}
