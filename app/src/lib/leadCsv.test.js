import { expect, test } from 'vitest';
import { escapeLeadCsvCell } from './leadCsv';

test('quotes lead text and prevents spreadsheet formulas from submitted inquiry fields', () => {
  expect(escapeLeadCsvCell('hello, "team"')).toBe('"hello, ""team"""');
  expect(escapeLeadCsvCell('=HYPERLINK("https://example.invalid")'))
    .toBe('"\'=HYPERLINK(""https://example.invalid"")"');
  expect(escapeLeadCsvCell(null)).toBe('""');
});
