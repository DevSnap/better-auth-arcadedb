/** Internal schema shared by all models using database-generated numeric IDs. */
export const serialCounter = "__better_auth_serial";

export function safeSerial(value: unknown): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach(safeSerial);
    return;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new RangeError("Serial IDs and references must be safe integers");
}

/** DDL literals are separate from bound runtime values. */
export function literal(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
