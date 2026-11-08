// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import PayperDispatchStatus from './PayperDispatchStatus';

const query = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => query(...args) } }));
afterEach(() => { cleanup(); query.mockReset(); });

function mockControl(control, payment) {
  query.mockImplementation((table) => ({ select: () => ({ eq: () => ({ single: () =>
    Promise.resolve(table === 'payper_dispatch_control'
      ? { data: control, error: null } : { data: payment, error: null }) }) }) }));
}

test('warns Admin when a canceled canary target blocks unrelated purchases', async () => {
  mockControl({ enabled: true, dispatch_mode: 'canary', canary_payment_id: 'old-payment', dispatch_remaining: 1 },
    { status: 'failed' });
  render(<PayperDispatchStatus />);
  expect(await screen.findByText(/Payper מכוון לתשלום שבוטל/)).toBeInTheDocument();
  expect(screen.getByText(/old-payment/)).toBeInTheDocument();
  expect(query).toHaveBeenCalledWith('payment_transactions');
});

test('keeps the canceled-target warning after automatic retirement turns dispatch off', async () => {
  mockControl({ enabled: false, dispatch_mode: 'canary', canary_payment_id: 'retired-payment', dispatch_remaining: 1 },
    { status: 'failed' });
  render(<PayperDispatchStatus />);
  expect(await screen.findByText(/Payper מכוון לתשלום שבוטל/)).toBeInTheDocument();
});

test('reports continuous mode without looking up a canary payment', async () => {
  mockControl({ enabled: true, dispatch_mode: 'continuous', canary_payment_id: null, dispatch_remaining: 0 });
  render(<PayperDispatchStatus />);
  expect(await screen.findByText(/מצב הפצה רציף/)).toBeInTheDocument();
  expect(query).not.toHaveBeenCalledWith('payment_transactions');
});

test('does not mistake an enabled one-payment canary for continuous operation', async () => {
  mockControl({ enabled: true, dispatch_mode: 'canary', canary_payment_id: 'new-payment', dispatch_remaining: 1 },
    { status: 'pending_provider' });
  render(<PayperDispatchStatus />);
  expect(await screen.findByText(/לתשלום אחד בלבד/)).toBeInTheDocument();
});
