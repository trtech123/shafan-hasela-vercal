// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import QuoteDeliveryPanel from './QuoteDeliveryPanel';

const state = vi.hoisted(() => ({ role: 'admin', invoke: vi.fn(), history: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  functions: { invoke: (...args) => state.invoke(...args) },
  from: () => ({ select: () => ({ eq: () => ({ order: () => state.history() }) }) }),
} }));
const quote = { id: 'synthetic-quote', quotation_revision_id: 'synthetic-revision', client_email: 'synthetic@example.com', client_phone: '0501234567' };
beforeEach(() => {
  sessionStorage.clear(); state.role = 'admin'; state.invoke.mockReset(); state.history.mockReset().mockResolvedValue({ data: [], error: null });
  state.invoke.mockImplementation(async (name, options) => options.body.action === 'capabilities'
    ? { data: { ok: true, canSend: name === 'send-quote-email' }, error: null }
    : { data: null, error: new Error('lost response') });
});
afterEach(cleanup);

test('only authorized staff can read delivery state', () => {
  state.role = 'מדריך';
  render(<QuoteDeliveryPanel quote={quote} createPdf={vi.fn()} />);
  expect(state.invoke).not.toHaveBeenCalled();
  expect(state.history).not.toHaveBeenCalled();
});

test('an interrupted send stays blocked until status is reconciled', async () => {
  const createPdf = vi.fn().mockResolvedValue({ output: () => 'data:application/pdf;base64,cGRm' });
  render(<QuoteDeliveryPanel quote={quote} createPdf={createPdf} />);
  const send = await screen.findByRole('button', { name: 'שלח במייל' });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('השליחה מתעכבת'));
  expect(send).toBeDisabled();
  expect(state.invoke.mock.calls.filter(([name, options]) => name === 'send-quote-email' && options.body.action === 'send')).toHaveLength(1);
});
