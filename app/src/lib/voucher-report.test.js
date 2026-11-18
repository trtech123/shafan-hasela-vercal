import { expect, test, vi } from 'vitest';
import { fetchVoucherReport, REPORT_LIMIT } from './voucher-report';

function database(rows, count = rows.length) {
  const range = vi.fn().mockResolvedValue({ data: rows, count, error: null });
  const query = { lte: () => query, order: () => query, range };
  const from = vi.fn(() => ({ select: () => query }));
  return { from, range };
}

test('report reads immutable voucher snapshots without changing records', async () => {
  const db = database([{ voucher_number: 'SYN-1' }]);
  await expect(fetchVoucherReport(db, {}, { cutoff: '2026-11-18T00:00:00Z' })).resolves.toEqual([{ voucher_number: 'SYN-1' }]);
  expect(db.from).toHaveBeenCalledWith('hakafa_vouchers');
  expect(db.range).toHaveBeenCalledWith(0, 199);
});

test('oversized report fails without returning a partial document', async () => {
  const db = database([{ voucher_number: 'SYN-1' }], REPORT_LIMIT + 1);
  await expect(fetchVoucherReport(db, {})).rejects.toThrow('report_too_large');
});
