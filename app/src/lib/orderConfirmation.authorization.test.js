import { expect, test } from 'vitest';
import { canSendOrderConfirmation } from './orderConfirmation';

test('signature staff controls match the server role allowlist', () => {
  expect(canSendOrderConfirmation('admin')).toBe(true);
  expect(canSendOrderConfirmation('operations')).toBe(true);
  expect(canSendOrderConfirmation('cashier')).toBe(true);
  expect(canSendOrderConfirmation('מדריך')).toBe(false);
  expect(canSendOrderConfirmation('קופאי')).toBe(false);
});
