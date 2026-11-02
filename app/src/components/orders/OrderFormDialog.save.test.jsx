// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  blocks: [], orders: [], saveResult: { data: { id: 'order-1' }, error: null },
  instructors: [{ id: 'instructor-1', full_name: 'מדריך', phone: '0500000000', status: 'פעיל' }],
  writes: [], success: vi.fn(), error: vi.fn(), info: vi.fn(),
}));

vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (table) => {
    let mutation = false;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      update: (data) => { mutation = true; state.writes.push({ table, kind: 'update', data }); return builder; },
      insert: (data) => { mutation = true; state.writes.push({ table, kind: 'insert', data }); return builder; },
      single: () => Promise.resolve(state.saveResult),
      then: (resolve) => resolve({ data: table === 'blocked_slots' ? state.blocks : table === 'orders' && !mutation ? state.orders : table === 'instructors' ? state.instructors : [], error: null }),
    };
    return builder;
  } },
}));
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error, info: state.info } }));

import OrderFormDialog from './OrderFormDialog';

const order = {
  id: 'order-1', order_number: 'ORD-1', client_name: 'לקוח', client_phone: '0500000000',
  activity_date: '2026-11-10', start_time: '10:00:00', end_time: '11:00:00',
  site: 'עכו', status: 'מאושר', instructor_id: 'instructor-1', activity_id: 'activity-1',
};
const renderDialog = (currentOrder = order) => {
  const onSaved = vi.fn();
  const view = render(<OrderFormDialog open onClose={vi.fn()} order={currentOrder} activities={[{ id: 'activity-1', name: 'פעילות', status: 'פעיל' }]} onSaved={onSaved} />);
  return { ...view, onSaved };
};

beforeEach(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
  state.blocks = [];
  state.orders = [];
  state.saveResult = { data: { id: 'order-1' }, error: null };
  state.writes = [];
  state.success.mockClear();
  state.error.mockClear();
});
afterEach(cleanup);

describe('existing order save', () => {
  test('persists a changed date and linked activity/instructor before showing success', async () => {
    const { onSaved } = renderDialog();
    const date = document.querySelector('input[type="date"]');
    await waitFor(() => expect(date).toHaveValue('2026-11-10'));
    fireEvent.change(date, { target: { value: '2026-11-11' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].data).toMatchObject({ activity_date: '2026-11-11' });
    expect(state.writes[0].data).not.toHaveProperty('instructor_id');
    expect(state.writes[0].data).not.toHaveProperty('activity_id');
    expect(state.success).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test('never reports success when update returns no row', async () => {
    state.saveResult = { data: null, error: { message: 'No rows' } };
    const { onSaved } = renderDialog();
    await waitFor(() => expect(document.querySelector('input[type="date"]')).toHaveValue('2026-11-10'));
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-11' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(state.error).toHaveBeenCalledTimes(1));
    expect(state.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('requires explicit confirmation for another order, and cancellation does not write', async () => {
    state.orders = [{ ...order, id: 'other', order_number: 'ORD-2', activity_date: '2026-11-11', start_time: '10:30:00' }];
    renderDialog();
    await waitFor(() => expect(document.querySelector('input[type="date"]')).toHaveValue('2026-11-10'));
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-11' } });
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('ORD-2');
    expect(state.writes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול / חזרה לעריכה' }));
    expect(state.writes).toHaveLength(0);
    fireEvent.submit(document.querySelector('form'));
    fireEvent.click(await screen.findByRole('button', { name: 'אישור והמשך בכל זאת' }));
    await waitFor(() => expect(state.writes).toHaveLength(1));
  });

  test('editing onto a partial same-day booking warns without treating itself as a conflict', async () => {
    state.orders = [
      order,
      { ...order, id: 'partial', order_number: 'ORD-1051', activity_date: '2026-11-11', site: null, instructor_id: null, start_time: '10:00:00', end_time: null, status: 'ממתין לאישור' },
    ];
    renderDialog();
    await waitFor(() => expect(document.querySelector('input[type="date"]')).toHaveValue('2026-11-10'));
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-11' } });
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('ORD-1051');
    expect(state.writes).toHaveLength(0);
  });
});

test('new order warns before insert when Supabase returns a same-day partial booking', async () => {
  state.orders = [{ ...order, id: 'other', order_number: 'ORD-1051', activity_date: '2026-11-06', site: null, instructor_id: null, start_time: '09:00:00', end_time: null, status: 'ממתין לאישור' }];
  renderDialog(null);
  fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-06' } });
  fireEvent.click(screen.getByRole('button', { name: 'עכו' }));
  const startTrigger = screen.getByText('שעת התחלה').parentElement.querySelector('[role="combobox"]');
  fireEvent.keyDown(startTrigger, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '09:00' }));
  const endTrigger = screen.getByText('שעת סיום').parentElement.querySelector('[role="combobox"]');
  fireEvent.keyDown(endTrigger, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '10:00' }));
  expect(startTrigger).toHaveTextContent('09:00');
  expect(endTrigger).toHaveTextContent('10:00');
  fireEvent.submit(document.querySelector('form'));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('ORD-1051');
  expect(screen.getByRole('alertdialog')).toHaveTextContent('אתר לא צוין');
  expect(screen.getByRole('alertdialog')).toHaveTextContent('שעת סיום לא צוינה');
  expect(state.writes).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'ביטול / חזרה לעריכה' }));
  expect(state.writes).toHaveLength(0);
  fireEvent.submit(document.querySelector('form'));
  fireEvent.click(await screen.findByRole('button', { name: 'אישור והמשך בכל זאת' }));
  await waitFor(() => expect(state.writes).toHaveLength(1));
});

test('new order sends explicitly selected site and end time in the insert payload', async () => {
  renderDialog(null);
  fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-06' } });
  fireEvent.click(screen.getByRole('button', { name: 'עכו' }));
  const startTrigger = screen.getByText('שעת התחלה').parentElement.querySelector('[role="combobox"]');
  fireEvent.keyDown(startTrigger, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '09:00' }));
  const endTrigger = screen.getByText('שעת סיום').parentElement.querySelector('[role="combobox"]');
  fireEvent.keyDown(endTrigger, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '10:00' }));
  fireEvent.submit(document.querySelector('form'));
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(state.writes[0].data).toMatchObject({ site: 'עכו', start_time: '09:00', end_time: '10:00' });
});
