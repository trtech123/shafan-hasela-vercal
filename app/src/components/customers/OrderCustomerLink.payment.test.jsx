// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ choose: null, rpc: vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('./CustomerSelector', () => ({ default: ({ onSelect }) => {
  state.choose = onSelect;
  return <button onClick={() => onSelect({ id: 'customer-1', customer_kind: 'person', display_name: 'Test',
    billing_name: 'Test', billing_company_id: '', billing_accounting_email: '', vat_applicable: true })}>select incomplete customer</button>;
} }));
import OrderCustomerLink from './OrderCustomerLink';

afterEach(() => { cleanup(); state.rpc.mockReset(); state.choose = null; });

test('payment repair requires complete card billing before linking the existing order', async () => {
  const onLinked = vi.fn();
  state.rpc.mockResolvedValue({ data: { customer_snapshot_id: 'snapshot-1' }, error: null });
  render(<OrderCustomerLink order={{ id: 'order-1', customer_record_version: 0 }}
    requirePaymentReady onLinked={onLinked} />);
  fireEvent.click(screen.getByRole('button', { name: 'select incomplete customer' }));
  expect(screen.getByRole('button', { name: /אישור לקוח ופרטי חיוב להזמנה/ })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('יש להשלים');
  state.choose({ id: 'customer-1', customer_kind: 'person', display_name: 'Test', billing_name: 'Test',
    billing_company_id: '000000018', billing_accounting_email: 'test@example.invalid', vat_applicable: true });
  await waitFor(() => expect(screen.getByRole('button', { name: /אישור לקוח ופרטי חיוב להזמנה/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /אישור לקוח ופרטי חיוב להזמנה/ }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledWith('link_order_customer', {
    p_order_id: 'order-1', p_customer_id: 'customer-1', p_expected_version: 0,
  }));
  expect(onLinked).toHaveBeenCalledOnce();
});
