// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import PayperAdminAlert from './PayperAdminAlert';

const query = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...args) => query(...args) } }));
afterEach(() => { cleanup(); query.mockReset(); });

test('alerts admins to a durable billing exception with an accounting action', async () => {
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('1 תשלומים');
  expect(screen.getByRole('alert')).toHaveAttribute('href', '/accounting-operations');
  expect(query).toHaveBeenCalledWith('payper_accounting_exceptions');
});

test('aged missed wake and missing ledger are visible exceptions', async () => {
  query.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 2, error: null }) }) });
  render(<MemoryRouter><PayperAdminAlert /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('2 תשלומים');
});
