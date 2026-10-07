import { createPelecardCallbackHandler } from "../_shared/payment-handlers.ts";
import { assertCommercialPaymentsDisabled } from "../_shared/pelecard-test-config.ts";
import { schedulePaymentAccountingWake } from "../_shared/payment-accounting/runtime.ts";
import {
  createPelecardVerificationRuntime,
  servePaymentHandler,
} from "../_shared/payment-edge-runtime.ts";
import { decodePelecardNotification } from "../_shared/pelecard-transport.ts";

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
