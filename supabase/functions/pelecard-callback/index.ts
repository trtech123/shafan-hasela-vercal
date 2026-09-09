import { createPelecardCallbackHandler } from "../_shared/payment-handlers.ts";
import { schedulePaymentAccountingWake } from "../_shared/payment-accounting/runtime.ts";
import {
  createPaymentEdgeRuntime,
  servePaymentHandler,
  unconfiguredNotificationDecoder,
  unconfiguredVerificationProvider,
} from "../_shared/payment-edge-runtime.ts";

// capability_unconfigured until Pelecard confirms the callback and lookup map.
servePaymentHandler(() => {
  const runtime = createPaymentEdgeRuntime();
  return createPelecardCallbackHandler({
    store: runtime.store,
    provider: unconfiguredVerificationProvider,
    decodeNotification: unconfiguredNotificationDecoder,
    config: runtime.config,
    onPaymentSucceeded: (paymentId) => schedulePaymentAccountingWake(
      runtime.accounting.wakePaymentAccounting,
      paymentId,
    ),
  });
});
