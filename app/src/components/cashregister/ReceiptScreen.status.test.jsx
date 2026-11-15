// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import ReceiptScreen from './ReceiptScreen';

const base = { items: [{ id: 'item-1', name: 'Item', qty: 1, customPrice: 3 }],
  total: 3, timestamp: new Date('2026-11-05T12:00:00Z'), receiptNumber: 'RCP-1000' };
afterEach(cleanup);

test('deferred invoice-account sale is never displayed as a paid transaction', () => {
  render(<ReceiptScreen receipt={{ ...base, method: 'חשבונית' }} onNewSale={() => {}} />);
  expect(screen.getByText(/ממתינה לתשלום/)).toBeInTheDocument();
  expect(screen.queryByText('התשלום אושר!')).not.toBeInTheDocument();
});

test('the POS printout is identified as an internal record, not a tax document', () => {
  render(<ReceiptScreen receipt={{ ...base, method: 'מזומן' }} onNewSale={() => {}} />);
  expect(screen.getByText(/אישור מכירה פנימי RCP-1000/)).toBeInTheDocument();
  expect(screen.getByText(/אינו חשבונית מס או קבלה חשבונאית/)).toBeInTheDocument();
});

test('sale confirmation and printed copy use the business display name', () => {
  const write = vi.fn();
  const print = vi.fn();
  const open = vi.spyOn(window, 'open').mockReturnValue({ document: { write, close: vi.fn() }, print });
  try {
    render(<ReceiptScreen receipt={{ ...base, method: 'מזומן' }} onNewSale={() => {}} />);
    expect(screen.getByRole('heading', { name: 'שפן הסלע' })).toBeInTheDocument();
    expect(screen.getByText(/שפן הסלע — תודה!/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /הדפס אישור מכירה פנימי/ }));
    expect(write.mock.calls[0][0]).toContain('שפן הסלע');
    expect(write.mock.calls[0][0]).toContain('אישור מכירה פנימי');
    expect(print).toHaveBeenCalledOnce();
  } finally { open.mockRestore(); }
});
