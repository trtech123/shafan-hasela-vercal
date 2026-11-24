import { describe, expect, test } from 'vitest';
import { accountantMonthlyRows, monthlyReportCsv, summarizeMonthlyPayments } from './monthlyFinancial';

describe('monthly payment report', () => {
  test('keeps payment, refund, method and day counts distinct', () => {
    const rows = [
      { day: '2026-11-01', site: 'עכו', payment_method: 'אשראי',
        completed_count: 2, gross_amount: 30, refund_count: 1, refund_amount: 5,
        issued_document_count: 2 },
      { day: '2026-11-01', site: 'טבריה', payment_method: 'מזומן',
        completed_count: 1, gross_amount: 7.5, refund_count: 0, refund_amount: 0 },
      { day: '2026-11-02', site: 'עכו', payment_method: 'אשראי',
        completed_count: 1, gross_amount: 10, refund_count: 0, refund_amount: 0 },
    ];
    const result = summarizeMonthlyPayments(rows);
    expect(result.total).toEqual({ payments: 4, gross: 4750, refunds: 1,
      refunded: 500, documents: 2, net: 4250 });
    expect(result.byMethod.find(([name]) => name === 'אשראי')[1].payments).toBe(3);
    expect(result.byDay.find(([day]) => day === '2026-11-01')[1].net).toBe(3250);
    expect(result.bySite.find(([site]) => site === 'עכו')[1].net).toBe(3500);
    expect(monthlyReportCsv(rows, 2026, 11)).toContain('2026-11');
  });

  test('rejects impossible negative source aggregates', () => {
    expect(() => summarizeMonthlyPayments([{ day: '2026-11-01',
      payment_method: 'מזומן', completed_count: -1 }])).toThrow('monthly_report_invalid');
  });

  test('keeps unavailable issuer and voucher detail distinct from the verified card subtotal', () => {
    const summary = summarizeMonthlyPayments([{ day: '2026-11-24', site: 'עכו',
      payment_method: 'אשראי', completed_count: 2, gross_amount: 30,
      refund_count: 0, refund_amount: 0 }]);
    const layout = accountantMonthlyRows(summary);
    expect(layout.find(row => row.type === 'Visa').count).toBeNull();
    expect(layout.find(row => row.type === 'שובר').ils).toBeNull();
    expect(layout.find(row => row.type === 'סה״כ אשראי')).toMatchObject({
      count: 2, original: 30, ils: 30, average: 15,
    });
    expect(layout.find(row => row.type === 'סה״כ').ils).toBe(30);
    const csv = monthlyReportCsv([{ day: '2026-11-24', site: 'עכו',
      payment_method: 'אשראי', completed_count: 2, gross_amount: 30,
      refund_count: 0, refund_amount: 0 }], 2026, 11);
    expect(csv).toContain('"סכום במטבע מקור"');
    expect(csv).toContain('"Visa","שקל","לא זמין"');
  });
});
