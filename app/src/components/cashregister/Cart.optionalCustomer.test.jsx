// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@/components/cashregister/LinkOrderSearch', () => ({ default: () =>
  <button type="button">קשר להזמנה קיימת (לא חובה)</button> }));

import Cart from './Cart';

afterEach(cleanup);

test('standalone cart can continue without selecting a customer or order', () => {
  const onCheckout = vi.fn();
  const onLinkOrder = vi.fn();
  render(<Cart items={[{ id: 'product-1', kind: 'product', name: 'Water', qty: 1, customPrice: 5 }]}
    subtotal={5} discount={null} discountAmount={0} discountValid total={5}
    linkedOrder={null} onLinkOrder={onLinkOrder} onSetDiscount={vi.fn()}
    onUpdateQty={vi.fn()} onUpdatePrice={vi.fn()} onRemove={vi.fn()} onCheckout={onCheckout} />);
  expect(screen.getByText('אפשר להמשיך לתשלום ללא בחירת לקוח או פתיחת כרטיס לקוח.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /המשך לתשלום/ }));
  expect(onCheckout).toHaveBeenCalledTimes(1);
  expect(onLinkOrder).not.toHaveBeenCalled();
});
