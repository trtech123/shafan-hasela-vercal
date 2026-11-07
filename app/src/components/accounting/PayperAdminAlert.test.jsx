// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import PayperAdminAlert from './PayperAdminAlert';

const query = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => query(...args) } }));
afterEach(() => { cleanup(); query.mockReset(); vi.useRealTimers(); });

test('alerts admins to a durable billing exception with an accounting action', async () => {
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('1 תשלומים');
  expect(screen.getByRole('link', { name: /פתחו את בקרת הנה״ח/ })).toHaveAttribute('href', '/accounting-operations');
  expect(query).toHaveBeenCalledWith('payper_accounting_exceptions');
});

test('aged missed wake and missing ledger are visible exceptions', async () => {
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 2, error: null }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('2 תשלומים');
});

test('close button hides the prominent warning while keeping a status-page link', async () => {
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 2, error: null }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveAttribute('dir', 'rtl');
  fireEvent.click(screen.getByRole('button', { name: 'סגור התראת Payper' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Payper.*2.*בקרת הנה״ח/ })).toHaveAttribute('href', '/accounting-operations');
  expect(query).toHaveBeenCalledTimes(1);
});

test('prominent warning collapses after eight seconds without clearing the issue', async () => {
  vi.useFakeTimers();
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(7999); });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Payper.*1.*בקרת הנה״ח/ })).toBeInTheDocument();
});

test('an unavailable exception check remains accessible after dismissing its banner', async () => {
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: null, error: { message: 'unavailable' } }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('בקרת מסמכי Payper אינה זמינה');
  fireEvent.click(screen.getByRole('button', { name: 'סגור התראת Payper' }));
  expect(screen.getByRole('link', { name: /Payper.*הבקרה אינה זמינה.*בקרת הנה״ח/ })).toHaveAttribute('href', '/accounting-operations');
});
