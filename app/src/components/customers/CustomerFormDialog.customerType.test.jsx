// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import CustomerFormDialog from './CustomerFormDialog';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  rpc: (...args) => rpc(...args),
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
} }));

afterEach(() => { cleanup(); rpc.mockReset(); });

test('saves the five business types separately from person or organization', async () => {
  rpc.mockImplementation((name, args) => Promise.resolve(name === 'save_customer'
    ? { data: { id: args.p_id }, error: null }
    : { data: [], error: null }));
  render(<CustomerFormDialog onClose={() => {}} onSaved={() => {}} />);
  const businessType = screen.getByLabelText('סיווג עסקי');
  expect([...businessType.options].map(option => option.textContent)).toEqual([
    'ללא סיווג', 'חינוכית', 'גפ״ן', 'סוכן/מפיק', 'חברה', 'לקוח פרטי',
  ]);
  fireEvent.change(screen.getByLabelText('אדם או ארגון'), { target: { value: 'organization' } });
  fireEvent.change(businessType, { target: { value: 'גפ״ן' } });
  fireEvent.change(screen.getByLabelText('שם לתצוגה'), { target: { value: 'בית ספר לדוגמה' } });
  fireEvent.change(screen.getByLabelText('מדיניות מע״מ'), { target: { value: 'true' } });
  fireEvent.click(screen.getByRole('button', { name: 'שמירת כרטיס לקוח' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_customer', expect.objectContaining({
    p_data: expect.objectContaining({ customer_kind: 'organization', customer_type: 'גפ״ן' }),
  })));
});

test('keeps an existing unclassified customer unclassified on edit', async () => {
  rpc.mockImplementation((name, args) => Promise.resolve(name === 'save_customer'
    ? { data: { id: args.p_id }, error: null }
    : { data: [], error: null }));
  render(<CustomerFormDialog customer={{ id: 'customer-1', version: 2, customer_kind: 'person',
    display_name: 'לקוח ותיק', vat_applicable: true, customer_type: null }}
    onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByLabelText('סיווג עסקי')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'שמירת כרטיס לקוח' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_customer', expect.objectContaining({
    p_id: 'customer-1', p_expected_version: 2,
    p_data: expect.objectContaining({ customer_kind: 'person', customer_type: null }),
  })));
});
