import { describe, expect, test } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { monthlyReportXlsx } from './monthlyExcel';

describe('monthly Excel export', () => {
  test('creates a real XLSX with the accountant columns and auditable detail', () => {
    const bytes = monthlyReportXlsx([{ day: '2026-11-24', site: 'נוף הגליל',
      register_number: '004', payment_method: 'אשראי', completed_count: 2,
      gross_amount: 354, refund_count: 1, refund_amount: 118,
      issued_document_count: 2 }], 2026, 11,
    { identified_customers: 1, unidentified_payments: 1 });
    expect(Array.from(bytes.slice(0, 4))).toEqual([80, 75, 3, 4]);
    const files = unzipSync(bytes);
    const summary = strFromU8(files['xl/worksheets/sheet1.xml']);
    const detail = strFromU8(files['xl/worksheets/sheet2.xml']);
    expect(summary).toContain('American Express');
    expect(summary).toContain('Visa');
    expect(summary).toContain('לא זמין');
    expect(summary).toContain('סכום במטבע מקור');
    expect(detail).toContain('נוף הגליל');
    expect(detail).toContain('<v>354</v>');
    expect(detail).toContain('<v>236</v>');
  });
});
