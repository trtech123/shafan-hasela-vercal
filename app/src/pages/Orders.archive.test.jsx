// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [], role: 'admin', rpc: vi.fn(), success: vi.fn(), error: vi.fn(),
  queryModes: [],
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  from: (table) => {
    const query = { archived: null,
      select: () => query,
      is: (field) => { if (field === 'archived_at') query.archived = false; return query; },
      not: (field) => { if (field === 'archived_at') query.archived = true; return query; },
      order: () => query,
      limit: async () => {
        if (table === 'orders') {
          state.queryModes.push(query.archived);
          return { data: state.rows.filter(row => Boolean(row.archived_at) === query.archived), error: null };
        }
        return { data: table === 'activities' ? [{ id: 'activity-1', name: 'פעילות בדיקה' }] : [], error: null };
      },
      then: resolve => resolve({ data: [], error: null }),
    };
    return query;
  },
  rpc: state.rpc,
} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error } }));
vi.mock('../components/orders/OrderFormDialog', () => ({ default: () => null }));
vi.mock('../components/orders/InstructorEmailDialog', () => ({ default: () => null }));
vi.mock('../components/orders/InstructorDailyDialog', () => ({ default: () => null }));
vi.mock('../components/orders/OrderConfirmationPDF', () => ({ default: () => null }));
vi.mock('@/components/customers/OrderCustomerLink', () => ({ default: ({ order, requirePaymentReady, onLinked }) =>
  <button onClick={() => onLinked({ ...order, customer_snapshot_id: 'snapshot-1' })}>
    {requirePaymentReady ? 'link billing for payment' : 'link billing'}
  </button> }));

import Orders from './Orders';
import { subscribeOrderChanges } from '@/lib/orderEvents';

const order = {
  id: 'order-1', order_number: 'ORD-TEST-1', client_name: 'לקוח בדיקה',
  activity_id: 'activity-1', activity_date: '2026-10-01', status: 'בוטל',
  payment_status: 'לא שולם', total_price: 0, archived_at: null,
};

beforeEach(() => {
  state.rows = [{ ...order }];
  state.role = 'admin';
  state.queryModes = [];
  state.rpc.mockReset();
  state.success.mockReset();
  state.error.mockReset();
  state.rpc.mockImplementation(async (name, { p_order_id }) => {
    const row = state.rows.find(item => item.id === p_order_id);
    if (name === 'archive_order') row.archived_at = '2026-11-04T00:00:00Z';
    if (name === 'restore_order') row.archived_at = null;
    if (name === 'delete_order') {
      state.rows = state.rows.filter(item => item.id !== p_order_id);
      return { data: { id: p_order_id, deleted: true }, error: null };
    }
    return { data: { ...row }, error: null };
  });
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/orders'); });

test('billing deep link opens the existing order and returns to eligibility after linking', async () => {
  const id = 'a0000000-0000-4000-8000-000000000001';
  state.rows = [{ ...order, id, order_number: 'ORD-TEST-42', status: 'מאושר', total_price: 98 }];
  window.history.replaceState(null, '', `/orders?billingOrderId=${id}`);
  render(<Orders />);
  fireEvent.click(await screen.findByRole('button', { name: 'link billing for payment' }, { timeout: 10000 }));
  expect(await screen.findByRole('link', { name: 'חזרה לבדיקת זכאות ולתשלום הדיגיטלי' }, { timeout: 10000 }))
    .toHaveAttribute('href', `/payment/order?orderId=${id}`);
}, 15000);

const confirmArchive = (dialog) => {
  const button = within(dialog).getByRole('button', { name: 'העבר לארכיון' });
  expect(button).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  expect(button).toBeEnabled();
  fireEvent.click(button);
};

test('archives, hides after refresh, preserves the order in history and restores it', async () => {
  const changed = vi.fn();
  const unsubscribe = subscribeOrderChanges(changed);
  const view = render(<Orders />);
  expect((await screen.findAllByText('ORD-TEST-1')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'העברת הזמנה לארכיון' })[0]);
  const confirm = await screen.findByRole('alertdialog');
  expect(within(confirm).getByText(/פרטי ההזמנה והקשרים ההיסטוריים יישמרו/)).toBeInTheDocument();
  confirmArchive(confirm);
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('ההזמנה הועברה לארכיון'));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledWith('archive_order', {
    p_order_id: 'order-1', p_confirm_no_external_commitments: true,
  });
  expect(screen.queryByText('ORD-TEST-1')).not.toBeInTheDocument();
  expect(state.rows[0].archived_at).toBeTruthy();
  view.unmount();

  render(<Orders />);
  await screen.findByText('0 הזמנות פעילות');
  expect(screen.queryByText('ORD-TEST-1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
  expect((await screen.findAllByText('ORD-TEST-1')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'שחזור הזמנה' })[0]);
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'שחזר' }));
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('ההזמנה שוחזרה לרשימת ההזמנות'));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(state.rows[0].archived_at).toBeNull();
  expect(state.queryModes).toContain(true);
  expect(state.queryModes).toContain(false);
  unsubscribe();
});

test('deletes an eligible order only after the database confirms deletion', async () => {
  render(<Orders />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'מחיקת הזמנה לצמיתות' }))[0]);
  const dialog = await screen.findByRole('alertdialog');
  const confirm = within(dialog).getByRole('button', { name: 'מחק לצמיתות' });
  expect(confirm).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(confirm);
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('ההזמנה נמחקה ממסד הנתונים'));
  expect(state.rpc).toHaveBeenCalledWith('delete_order', { p_order_id: 'order-1', p_confirm_no_external_commitments: true });
  expect(state.rows).toHaveLength(0);
  expect(screen.queryByText('ORD-TEST-1')).not.toBeInTheDocument();
});

test('retains the order and shows a Hebrew error when deletion is blocked', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'order_delete_financial_dependency' } });
  render(<Orders />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'מחיקת הזמנה לצמיתות' }))[0]);
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'מחק לצמיתות' }));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('תשלום'));
  expect(state.rows).toHaveLength(1);
  expect(state.success).not.toHaveBeenCalled();
});

test('archives a pending unpaid order without changing its business status or amount', async () => {
  state.rows = [{ ...order, status: 'ממתין לאישור', total_price: 250, activity_date: '2026-11-10' }];
  render(<Orders />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'העברת הזמנה לארכיון' }))[0]);
  confirmArchive(await screen.findByRole('alertdialog'));
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('ההזמנה הועברה לארכיון'));
  expect(state.rows[0]).toMatchObject({ status: 'ממתין לאישור', payment_status: 'לא שולם', total_price: 250 });
});

test('shows a real database rejection and keeps confirmation open', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'order_archive_financial_dependency' } });
  render(<Orders />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'העברת הזמנה לארכיון' }))[0]);
  confirmArchive(await screen.findByRole('alertdialog'));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.stringContaining('order_archive_financial_dependency')));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toHaveTextContent('תשלום');
  expect(screen.getAllByText('ORD-TEST-1').length).toBeGreaterThan(0);
});

test('explains that an existing customer confirmation blocks pending-order archiving', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'order_archive_confirmation_history' } });
  render(<Orders />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'העברת הזמנה לארכיון' }))[0]);
  confirmArchive(await screen.findByRole('alertdialog'));
  await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toHaveTextContent('אישור'));
  expect(state.success).not.toHaveBeenCalled();
});

test('does not offer archive or restore to operations staff', async () => {
  state.role = 'אחמ"ש';
  render(<Orders />);
  await screen.findAllByText('ORD-TEST-1');
  expect(screen.queryByRole('button', { name: 'העברת הזמנה לארכיון' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ארכיון' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'מחיקת הזמנה לצמיתות' })).not.toBeInTheDocument();
  expect(state.rpc).not.toHaveBeenCalled();
});

test('rejects duplicate confirmation clicks while the RPC is pending', async () => {
  let complete;
  state.rpc.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<Orders />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'העברת הזמנה לארכיון' }))[0]);
  const confirm = await screen.findByRole('alertdialog');
  const button = within(confirm).getByRole('button', { name: 'העבר לארכיון' });
  fireEvent.click(within(confirm).getByRole('checkbox'));
  fireEvent.click(button);
  fireEvent.click(button);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  complete({ data: { ...order, archived_at: '2026-11-04T00:00:00Z' }, error: null });
  await waitFor(() => expect(state.success).toHaveBeenCalledTimes(1));
});
