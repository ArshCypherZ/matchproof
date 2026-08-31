/** CSV quoting per RFC 4180: quote a field when it can change the row shape. */
export function toCsvCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /["\r\n,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsvRow(
  values: readonly (string | number | boolean | null | undefined)[],
) {
  return `${values.map(toCsvCell).join(",")}\r\n`;
}
