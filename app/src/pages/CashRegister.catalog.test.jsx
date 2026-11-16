// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

const catalog = vi.hoisted(() => ({
  products: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'קפה קר', price: 5, status: 'פעיל', cafeteria_category: 'שתייה' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'כריך', price: 12, status: 'פעיל', cafeteria_category: 'מזון' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'מוצר כללי', price: 8, status: 'פעיל', cafeteria_category: null },
  ],
  activities: [
    { id: '44444444-4444-4444-8444-444444444444', name: 'סדנה', price_per_person: 20, status: 'פעיל', category: 'יום גיבוש' },
    { id: '55555555-5555-4555-8555-555555555555', name: 'ביקור', price_per_person: 10, status: 'פעיל', category: null },
  ],
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'קופאי', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => vi.fn() }));
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: table => ({
      select: () => ({
        eq: async () => ({ data: table === 'products' ? catalog.products : catalog.activities, error: null }),
      }),
    }),
  },
}));
vi.mock('@/components/cashregister/LinkOrderSearch', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import CashRegister from './CashRegister';

afterEach(cleanup);

test('cashier switches saved product and activity categories, searches, and keeps a mixed cart', async () => {
  render(<CashRegister />);
  expect(await screen.findByRole('button', { name: /ביקור/ })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'מוצרים' }));
  const productCategories = screen.getByRole('navigation', { name: 'קטגוריות מוצרים' });
  expect(productCategories).toHaveAttribute('dir', 'rtl');
  expect(productCategories).toHaveClass('overflow-x-auto');
  expect(within(productCategories).getByRole('button', { name: 'הכול' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(productCategories).getByRole('button', { name: 'שתייה' })).toBeInTheDocument();
  expect(within(productCategories).getByRole('button', { name: 'מזון' })).toBeInTheDocument();
  expect(within(productCategories).queryByRole('button', { name: 'גלידות' })).toBeNull();

  fireEvent.click(within(productCategories).getByRole('button', { name: 'שתייה' }));
  expect(within(productCategories).getByRole('button', { name: 'שתייה' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /קפה קר/ }));
  fireEvent.click(within(productCategories).getByRole('button', { name: 'מזון' }));
  expect(screen.queryByRole('button', { name: /קפה קר/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /כריך/ }));
  expect(screen.getByText('17₪')).toBeInTheDocument();

  fireEvent.change(screen.getByRole('searchbox', { name: 'חיפוש מוצר בקופה' }), { target: { value: 'לא קיים' } });
  expect(screen.getByText('לא נמצאו מוצרים בקטגוריה ובחיפוש שנבחרו.')).toBeInTheDocument();
  expect(screen.getByText('17₪')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'חיפוש מוצר בקופה' }), { target: { value: '' } });
  fireEvent.click(within(productCategories).getByRole('button', { name: 'הכול' }));
  expect(screen.getByRole('button', { name: /מוצר כללי/ })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'פעילויות ושירותים' }));
  const activityCategories = screen.getByRole('navigation', { name: 'קטגוריות פעילויות ושירותים' });
  fireEvent.click(within(activityCategories).getByRole('button', { name: 'יום גיבוש' }));
  expect(screen.getByRole('button', { name: /סדנה/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ביקור/ })).toBeNull();
  expect(screen.getByText('17₪')).toBeInTheDocument();
});
