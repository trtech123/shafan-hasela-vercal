// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import PelecardTransactions from './PelecardTransactions';

const state = vi.hoisted(() => ({ role: 'admin', request: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'synthetic-user', role: state.role } }) }));
vi.mock('@/payments/pelecardTransactions', () => ({ requestPelecardTransactions: (...args) => state.request(...args) }));
afterEach(() => { cleanup(); state.role = 'admin'; state.request.mockReset(); });

test('a non-admin never starts provider retrieval', () => {
  state.role = 'קופאי';
  render(<PelecardTransactions />);
  expect(screen.getByRole('alert')).toHaveTextContent('למנהלים בלבד');
  expect(state.request).not.toHaveBeenCalled();
});

test('admin view is read-only and queries only on an explicit click', async () => {
  state.request.mockResolvedValue({ transactions: [] });
  render(<PelecardTransactions />);
  expect(screen.getByText(/צפייה בלבד/)).toBeInTheDocument();
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'טעינת עסקאות' }));
  await waitFor(() => expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'range' }), expect.any(AbortSignal)));
  expect(screen.getByText(/מוצגות 0 מתוך 0/)).toBeInTheDocument();
});
