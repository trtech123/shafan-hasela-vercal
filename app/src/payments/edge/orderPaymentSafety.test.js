import { expect, test, vi } from 'vitest';
import { createSupabasePaymentStore } from '../../../../supabase/functions/_shared/payment-store.ts';
import { reconcilePayment } from '../../../../supabase/functions/_shared/payment-reconciliation.ts';

test('linked orders use the atomic authoritative order reservation RPC', async () => {
  const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: true }) };
  await expect(createSupabasePaymentStore(client).reserve({
    proposedPaymentId: 'payment', orderId: 'order', createdBy: 'staff',
    idempotencyKey: 'attempt', amountMinor: 100, currencyCode: 'ILS', checkoutSnapshot: {},
  })).rejects.toThrow('storage_unavailable');
  expect(client.rpc).toHaveBeenCalledWith('reserve_pelecard_order_payment', expect.any(Object));
});

test('an unknown provider status stays pending instead of authorizing a new charge', () => {
  const transaction = { providerTransactionId: 'tx', approvalId: 'approval',
    statusCode: 'unrecognized', amountMinor: 100, currencyCode: 'ILS',
    terminalNumber: 'fixture', merchantKey: 'payment' };
  expect(reconcilePayment({ status: 'pending_provider', amountMinor: 100,
    currencyCode: 'ILS', terminalNumber: 'fixture', merchantCorrelation: 'payment',
    successfulProviderStatusCodes: ['000'], failedProviderStatusCodes: ['006'],
  }, { confirmationValid: true }, { kind: 'verified', transaction,
    correlation: { kind: 'merchant_correlation', value: 'payment' },
  })).toEqual({ kind: 'remain_pending', code: 'provider_unknown_status' });
});
