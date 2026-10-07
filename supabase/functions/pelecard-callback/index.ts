import { createPelecardCallbackHandler } from "./_deployed_shared/payment-handlers.ts";
import { assertCommercialPaymentsDisabled } from "./_deployed_shared/pelecard-test-config.ts";
import { schedulePaymentAccountingWake } from "./_deployed_shared/payment-accounting/runtime.ts";
import {
  createPelecardVerificationRuntime,
  servePaymentHandler,
} from "./_deployed_shared/payment-edge-runtime.ts";
import { decodePelecardNotification } from "./_deployed_shared/pelecard-transport.ts";

servePaymentHandler(() => {
  assertCommercialPaymentsDisabled();
  const runtime = createPelecardVerificationRuntime();
  return createPelecardCallbackHandler({
    store: runtime.store,
    provider: runtime.provider,
    decodeNotification: decodePelecardNotification,
    config: runtime.config,
    onPaymentSucceeded: (paymentId) => schedulePaymentAccountingWake(
      runtime.accounting.wakePaymentAccounting,
      paymentId,
    ),
  });
});
