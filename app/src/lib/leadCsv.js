export function escapeLeadCsvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
