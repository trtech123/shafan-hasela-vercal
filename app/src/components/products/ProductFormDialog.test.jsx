// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ writes: [], success: vi.fn(), error: vi.fn(), role: 'קופאי' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error } }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {
  from: () => {
    const builder = {
      insert: (data) => { state.writes.push({ kind: 'insert', data }); return builder; },
      update: (data) => { state.writes.push({ kind: 'update', data }); return builder; },
      eq: () => builder,
      select: () => builder,
      single: () => Promise.resolve({ data: { id: 'product-1' }, error: null }),
    };
    return builder;
  },
} }));
import ProductFormDialog from './ProductFormDialog';

beforeEach(() => { state.writes = []; state.role = 'קופאי'; state.success.mockClear(); state.error.mockClear(); });
afterEach(cleanup);

describe('cashier cafeteria product form', () => {
  test('requires category and creates a classified product', async () => {
    render(<ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} cafeteriaMode />);
    expect(screen.getByText('תמונות מוצרים מנוהלות על ידי מנהל')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /העלאת תמונה/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'קפה קר' } });
    fireEvent.submit(document.querySelector('form'));
    expect(state.writes).toHaveLength(0);
    expect(state.error).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('קטגוריית קפיטריה'), { target: { value: 'שתייה' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]).toMatchObject({ kind: 'insert', data: { name: 'קפה קר', cafeteria_category: 'שתייה' } });
  });

  test('edits the selected category without changing the product identity', async () => {
    render(<ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} cafeteriaMode product={{ id: 'product-1', name: 'גלידה', cafeteria_category: 'גלידות', status: 'פעיל' }} />);
    await waitFor(() => expect(screen.getByLabelText('קטגוריית קפיטריה')).toHaveValue('גלידות'));
    fireEvent.change(screen.getByLabelText('קטגוריית קפיטריה'), { target: { value: 'מזון' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]).toMatchObject({ kind: 'update', data: { cafeteria_category: 'מזון' } });
  });

  test('allows only an admin to move an existing cafeteria product back to general products', async () => {
    state.role = 'admin';
    render(<ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} cafeteriaMode product={{ id: 'product-1', name: 'מוצר', cafeteria_category: 'מזון', status: 'פעיל' }} />);
    expect(screen.getByRole('button', { name: /העלאת תמונה/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('קטגוריית קפיטריה')).toHaveValue('מזון'));
    fireEvent.change(screen.getByLabelText('קטגוריית קפיטריה'), { target: { value: '' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].data.cafeteria_category).toBeNull();
  });
});
