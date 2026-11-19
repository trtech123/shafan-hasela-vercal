// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import QuotePDFDocument from './QuotePDFDocument';

vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('./QuoteDeliveryPanel', () => ({ default: () => <section aria-label="גרסאות ושליחת הצעה" /> }));
afterEach(cleanup);

const quote = { id: 'synthetic-quote', quotation_revision_id: 'synthetic-revision', quote_number: 'SYN-1',
  client_name: 'לקוח בדיקה', client_email: 'synthetic@example.invalid', client_phone: '0501234567', selected_activities: [] };

test('saved revision uses durable delivery controls and keeps download available', () => {
  render(<QuotePDFDocument quote={quote} onClose={() => {}} />);
  expect(screen.getByLabelText('גרסאות ושליחת הצעה')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'הורד PDF' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'שלח מייל' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'שלח וואטסאפ' })).not.toBeInTheDocument();
});

test('historical unversioned quote cannot call the incompatible legacy delivery endpoint', () => {
  render(<QuotePDFDocument quote={{ ...quote, quotation_revision_id: null }} onClose={() => {}} />);
  expect(screen.getByLabelText('גרסאות ושליחת הצעה')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'שלח מייל' })).not.toBeInTheDocument();
});
