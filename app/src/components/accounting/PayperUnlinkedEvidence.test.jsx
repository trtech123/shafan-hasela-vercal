// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/payments/physical/client', () => ({ getUnlinkedPhysicalEvidence: (...args) => state.read(...args) }));
import PayperUnlinkedEvidence from './PayperUnlinkedEvidence';

afterEach(() => { cleanup(); state.read.mockReset(); });

test('accounting shows an issued provider document without claiming payment settlement', async () => {
  state.read.mockResolvedValue([{ paymentId: '833db2d6-18b1-4d66-bbcd-4360b95a315c',
    orderId: '91d530c4-f819-4ce8-9c4b-e30010b9a866', orderNumber: 'ORD-1062',
    paymentState: 'uncertain', amountMinor: 100, providerTransactionId: '3199515577',
    documentNumber: '200006', linked: false,
    documentUrl: 'https://app.payper.co.il/public/invoice_show/3650292?ak=abcdefghijklmnop' }]);
  render(<PayperUnlinkedEvidence />);
  expect(await screen.findByText(/ORD-1062/)).toBeInTheDocument();
  expect(screen.getByText(/טרם קושר לתשלום ולמכירה/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /צפייה במסמך/ })).toHaveAttribute('href',
    'https://app.payper.co.il/public/invoice_show/3650292?ak=abcdefghijklmnop');
  expect(screen.queryByText(/התשלום הושלם/)).toBeNull();
});
