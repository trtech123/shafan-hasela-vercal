// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import OrderCollectionAction from './OrderCollectionAction';

afterEach(cleanup);
const orderId = '00000000-0000-4000-8000-000000000001';

it('offers collection only for unpaid and partially paid verified orders', () => {
  const { rerender } = render(<OrderCollectionAction orderId={orderId} allowed
    financial={{ state: 'unpaid', balanceMinor: 100 }} />);
  expect(screen.getByRole('link', { name: 'גבייה בקופה' })).toHaveAttribute('href',
    `/cashregister?orderId=${orderId}`);
  rerender(<OrderCollectionAction orderId={orderId} allowed
    financial={{ state: 'partial', balanceMinor: 50 }} />);
  expect(screen.getByRole('link', { name: 'גבייה בקופה' })).toBeInTheDocument();
});

it.each([
  ['paid', 'התשלום בוצע'],
  ['review', 'תשלום בבדיקה'],
  ['unavailable', 'גבייה לא זמינה'],
])('blocks a second collection when %s', (state, label) => {
  render(<OrderCollectionAction orderId={orderId} allowed financial={{ state }} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(label);
});

it('fails closed before the financial status loads', () => {
  render(<OrderCollectionAction orderId={orderId} allowed />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('תשלום בבדיקה');
});
