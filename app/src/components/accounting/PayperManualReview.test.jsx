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
  expect(query).toHaveBeenCalledWith('payper_document_ledger');
});

test('warns when the review ledger cannot be read', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: new Error('unavailable') }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByRole('alert')).toHaveTextContent('יש לבדוק את מצב המסמכים');
});

test('shows the durable missing-service-description review reason', async () => {
  query.mockReturnValue({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({
    data: [{ payment_id: 'payment-2', order_id: 'order-2', state: 'source_blocked',
      reconciliation_code: 'service_description_required' }], error: null,
  }) }) }) }) });
  render(<PayperManualReview />);
  expect(await screen.findByText('נדרש בירור תיאור השירות בחשבונית')).toBeInTheDocument();
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
