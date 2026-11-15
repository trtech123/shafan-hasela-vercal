import { expect, test, vi } from 'vitest';
import { requestOrderPayment } from './orderPayments';

const orderId = 'a0000000-0000-4000-8000-000000000001';

test('surfaces only server eligibility reasons from a rejected direct checkout call', async () => {
  const invoke = vi.fn(async () => ({ data: null, error: { context: {
    json: async () => ({ error: { code: 'order_billing_incomplete',
      issues: ['vat_required', 'billing_identity_required'] } }),
  } } }));
  await expect(requestOrderPayment({ functions: { invoke } }, { action: 'initialize', orderId }))
    .rejects.toMatchObject({ message: 'order_billing_incomplete',
      issues: ['vat_required', 'billing_identity_required'] });
  expect(invoke).toHaveBeenCalledOnce();
});
