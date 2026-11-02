// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const state = vi.hoisted(() => ({ role: 'admin', rows: [
  { id: 'general', name: 'פעילות טיפוס', cafeteria_category: null, status: 'פעיל' },
  { id: 'coffee', name: 'קפה קר', cafeteria_category: 'שתייה', status: 'פעיל' },
  { id: 'ice', name: 'גלידה', cafeteria_category: 'גלידות', status: 'פעיל' },
] }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: state.rows, error: null }) }) }) } }));
vi.mock('@/components/products/ProductFormDialog', () => ({ default: () => null }));
import Products from './Products';

beforeEach(() => { state.role = 'admin'; });
afterEach(cleanup);

test('admin general management searches only unclassified existing products', async () => {
  render(<MemoryRouter><Products /></MemoryRouter>);
  expect(await screen.findByText('פעילות טיפוס')).toBeInTheDocument();
  expect(screen.queryByText('קפה קר')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'חיפוש מוצר לפי שם' }), { target: { value: 'לא קיים' } });
  expect(screen.getByText('לא נמצאו מוצרים התואמים לחיפוש.')).toBeInTheDocument();
});

test('cashier cafeteria tab combines Hebrew search with category without exposing general products', async () => {
  state.role = 'קופאי';
  render(<MemoryRouter><Products cafeteria /></MemoryRouter>);
  expect(await screen.findByText('קפה קר')).toBeInTheDocument();
  expect(screen.queryByText('פעילות טיפוס')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'חיפוש מוצר לפי שם' }), { target: { value: 'קפה' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'סינון קטגוריה' }), { target: { value: 'גלידות' } });
  expect(screen.getByText('לא נמצאו מוצרים התואמים לחיפוש.')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'סינון קטגוריה' }), { target: { value: 'שתייה' } });
  await waitFor(() => expect(screen.getByText('קפה קר')).toBeInTheDocument());
});

test('cashier cannot open general product management by direct route', async () => {
  state.role = 'קופאי';
  render(<MemoryRouter initialEntries={['/products']}><Routes><Route path="/products" element={<Products />} /><Route path="/" element={<h1>לוח זמנים</h1>} /></Routes></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'לוח זמנים' })).toBeInTheDocument();
});

test('admin category and name filters stay in the cafeteria tab when switching tabs', async () => {
  render(<MemoryRouter initialEntries={['/cafeteria-products']}><Routes>
    <Route path="/cafeteria-products" element={<Products cafeteria />} />
    <Route path="/products" element={<Products />} />
  </Routes></MemoryRouter>);
  expect(await screen.findByText('קפה קר')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'סינון קטגוריה' }), { target: { value: 'שתייה' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'חיפוש מוצר לפי שם' }), { target: { value: 'קפה' } });
  expect(screen.queryByText('גלידה')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'ניהול מוצרים' }));
  expect(await screen.findByText('פעילות טיפוס')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'חיפוש מוצר לפי שם' })).toHaveValue('');
  expect(screen.queryByRole('combobox', { name: 'סינון קטגוריה' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'חיפוש מוצר לפי שם' }), { target: { value: 'טיפוס' } });
  expect(screen.getByText('פעילות טיפוס')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'ניהול מוצרי קפיטריה' }));
  expect(await screen.findByText('קפה קר')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'סינון קטגוריה' })).toHaveValue('שתייה');
  expect(screen.getByRole('textbox', { name: 'חיפוש מוצר לפי שם' })).toHaveValue('קפה');
});
