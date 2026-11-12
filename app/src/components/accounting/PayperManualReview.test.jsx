// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import PayperManualReview from './PayperManualReview';

const query = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => query(...args) } }));
afterEach(cleanup);

test('shows a durable manual review obligation without customer identity data', async () => {
  const rows = [{ payment_id: 'payment-1', order_id: 'order-1', state: 'source_blocked',
    reconciliation_code: 'billing_identity_required', created_at: '2026-10-28T00:00:00Z' }];
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText('נדרש בירור זהות לחיוב')).toBeInTheDocument();
  expect(screen.getByText(/payment-1/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('ניסיון חדש מחייב אישור מוסמך שלא נוצר מסמך קודם');
  expect(screen.getByRole('region', { name: 'בדיקה ידנית למסמכי Payper' }).textContent).not.toMatch(/000000018/);
  expect(query).toHaveBeenCalledWith('payper_accounting_exceptions');
});

test('warns when the review ledger cannot be read', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: new Error('unavailable') }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByRole('alert')).toHaveTextContent('יש לבדוק את מצב המסמכים');
});

test('gives the administrator a specific credential repair action without exposing credentials', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'payment-credentials', sale_id: 'sale-1', state: 'source_blocked',
      reconciliation_code: 'provider_credentials_rejected' }], error: null,
  }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText(/פלאקארד דחתה את פרטי הגישה/)).toBeInTheDocument();
  expect(screen.getByText(/payment-credentials/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'בדיקה ידנית למסמכי Payper' }).textContent)
    .not.toMatch(/gateway-secret/);
});

test('shows the durable missing-service-description review reason', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'payment-2', order_id: 'order-2', state: 'source_blocked',
      reconciliation_code: 'service_description_required' }], error: null,
  }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText('נדרש בירור תיאור השירות בחשבונית')).toBeInTheDocument();
});

test('shows an accountant-managed paid sale as an actionable manual obligation', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'held-payment', sale_id: 'sale-1024', amount: 0.15,
      state: 'source_blocked', reconciliation_code: 'manual_accounting_hold' }], error: null,
  }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText(/התשלום הועבר לטיפול חשבונאי ידני/)).toBeInTheDocument();
  expect(screen.getByText(/held-payment/)).toBeInTheDocument();
  expect(screen.getByText(/₪0.15/)).toBeInTheDocument();
  expect(screen.queryByText(/מסמך שהופק/)).not.toBeInTheDocument();
});

test('offers a dedicated manual reconciliation action only for a physical provider hold', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'physical-payment', sale_id: 'physical-sale', amount: 4,
      state: 'source_blocked', reconciliation_code: 'physical_provider_confirmation_required' }], error: null,
  }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText(/physical-payment/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /רישום מסמך ידני מאומת/ })).toBeInTheDocument();
});

test('warns the administrator that a provider timeout cannot be retried automatically', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'payment-3', order_id: 'order-3', state: 'reconciliation_required',
      reconciliation_code: 'provider_transport_uncertain' }], error: null,
  }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText('לא התקבלה תשובה ודאית מהספק; אין לנסות שוב אוטומטית')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('אישור מוסמך שלא נוצר מסמך קודם');
});

test('monitors pending automatic invoice work without suggesting a provider retry', async () => {
  const states = vi.fn(() => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'pending-payment', order_id: 'pending-order', state: 'eligible',
      reconciliation_code: null, created_at: '2026-11-01T00:00:00Z' }], error: null,
  }) }) }));
  query.mockReturnValue({ select: () => ({ in: states }) });
  render(<PayperManualReview />);
  expect(await screen.findByText(/ממתין לעיבוד אוטומטי/)).toBeInTheDocument();
  expect(states).toHaveBeenCalledWith('state', expect.arrayContaining(['eligible', 'source_frozen', 'dispatch_reserved']));
  expect(screen.getByText(/pending-payment/)).toBeInTheDocument();
  expect(screen.getByText(/pending-payment/).parentElement).not.toHaveTextContent('אין להפיק מסמך חוזר');
});
