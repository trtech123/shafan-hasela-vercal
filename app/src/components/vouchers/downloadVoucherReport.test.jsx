// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { downloadVoucherReport } from './downloadVoucherReport';

const pdf = vi.hoisted(() => ({
  getNumberOfPages: vi.fn(() => 2), setPage: vi.fn(), setFontSize: vi.fn(),
  setTextColor: vi.fn(), text: vi.fn(), save: vi.fn(),
}));
vi.mock('@/components/quotes/quotePdf', () => ({ buildQuotePdf: vi.fn(async () => pdf) }));

test('downloads a two-page informational report without a provider or database write', async () => {
  const result = await downloadVoucherReport({
    rows: [{ voucher_number: 'SYN-1', created_at: '2026-11-18T10:00:00Z' }],
    generatedAt: '2026-11-18T12:00:00Z',
  });
  expect(result).toEqual({ count: 1, pages: 2 });
  expect(pdf.getNumberOfPages).toHaveBeenCalledOnce();
  expect(pdf.setPage.mock.calls).toEqual([[1], [2]]);
  expect(pdf.save).toHaveBeenCalledWith('hakafa-report-2026-11-18.pdf');
});
