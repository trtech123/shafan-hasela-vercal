// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import Customers from './Customers';

let role = 'admin';
const rpc = vi.fn();
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...args) => rpc(...args) } }));
vi.mock('@/components/customers/CustomerFormDialog', () => ({ default: ({ onClose }) => <button onClick={onClose}>סגירת טופס</button> }));

afterEach(() => { cleanup(); rpc.mockReset(); role = 'admin'; });

test('authorized staff can find customers and open the existing form', async () => {
  rpc.mockResolvedValue({ data: [{ id: 'c1', display_name: 'לקוח קיים', version: 1 }], error: null });
  render(<Customers />);
  expect(await screen.findByRole('heading', { name: 'לקוח קיים' })).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledWith('search_customers', { p_search: '', p_include_archived: false });
  fireEvent.click(screen.getByRole('button', { name: 'לקוח חדש' }));
  expect(screen.getByRole('button', { name: 'סגירת טופס' })).toBeInTheDocument();
});

test('archive uses the selected version and refreshes after success', async () => {
  rpc.mockImplementation((name) => Promise.resolve(name === 'archive_customer'
    ? { data: { id: 'c1' }, error: null }
    : { data: [{ id: 'c1', display_name: 'לקוח קיים', version: 7 }], error: null }));
  render(<Customers />);
  fireEvent.click(await screen.findByRole('button', { name: 'העברה לארכיון' }));
  fireEvent.click(screen.getByRole('button', { name: 'אישור העברה לארכיון' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('archive_customer', { p_id: 'c1', p_expected_version: 7 }));
  await waitFor(() => expect(rpc.mock.calls.filter(([name]) => name === 'search_customers')).toHaveLength(2));
});

test('instructors cannot search or manage customers', () => {
  role = 'מדריך';
  render(<Customers />);
  expect(screen.getByRole('alert')).toHaveTextContent('אין הרשאה');
  expect(rpc).not.toHaveBeenCalled();
});
