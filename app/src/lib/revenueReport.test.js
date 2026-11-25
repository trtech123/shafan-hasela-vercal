import { describe, expect, it } from 'vitest';
import { summarizeRevenueRows, revenueCsv } from './revenueReport.js';

describe('revenue report presentation', () => {
  const rows = [
    { eventDate: '2026-11-10', site: 'עכו', customerType: 'חברה', kind: 'order', method: null, amountMinor: 10000, eventCount: 1 },
    { eventDate: '2026-11-10', site: 'טבריה', customerType: null, kind: 'cancelled', method: null, amountMinor: 5000, eventCount: 1 },
    { eventDate: '2026-11-11', site: 'עכו', customerType: 'חברה', kind: 'receipt', method: 'Pelecard', amountMinor: 7000, eventCount: 1 },
    { eventDate: '2026-11-12', site: 'עכו', customerType: 'חברה', kind: 'receipt', method: 'מזומן', amountMinor: 2000, eventCount: 1 },
    { eventDate: '2026-11-13', site: 'עכו', customerType: 'חברה', kind: 'refund', method: 'Pelecard', amountMinor: 1000, eventCount: 1 },
    { eventDate: '2026-11-13', site: 'עכו', customerType: 'חברה', kind: 'void', method: 'Pelecard', amountMinor: 500, eventCount: 1 },
  ];

  it('keeps order value separate from cash flow and calculates net receipts', () => {
    expect(summarizeRevenueRows(rows)).toEqual({
      orderMinor: 10000, cancelledMinor: 5000, receiptMinor: 9000,
      refundMinor: 1000, voidMinor: 500, netMinor: 7500,
    });
  });

  it('exports actual filtered rows as a BOM CSV with safe cells', () => {
    const csv = revenueCsv([{ ...rows[0], site: '=1+1' }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('100.00');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
