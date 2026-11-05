// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test } from 'vitest';
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
  expect(screen.getByText(/אישור מכירה פנימי/)).toBeInTheDocument();
  expect(screen.getByText(/אינו חשבונית מס או קבלה חשבונאית/)).toBeInTheDocument();
});
