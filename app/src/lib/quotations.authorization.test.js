import { expect, test } from 'vitest';
import { canManageQuotations } from './quotations';

test('quotation delivery controls match the Edge Function staff role allowlist', () => {
  expect(canManageQuotations('admin')).toBe(true);
  expect(canManageQuotations('operations')).toBe(true);
  expect(canManageQuotations('אחמ"ש')).toBe(false);
  expect(canManageQuotations('cashier')).toBe(false);
});
