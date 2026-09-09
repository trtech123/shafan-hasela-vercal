import { createPelecardVerifyHandler } from "../_shared/payment-handlers.ts";
import {
  createPaymentEdgeRuntime,
  servePaymentHandler,
  unconfiguredNotificationDecoder,
  unconfiguredVerificationProvider,
} from "../_shared/payment-edge-runtime.ts";

// capability_unconfigured until Pelecard confirms the return and lookup map.
servePaymentHandler(() => {
  const runtime = createPaymentEdgeRuntime();
  return createPelecardVerifyHandler({
    auth: runtime.auth,
    store: runtime.store,
    provider: unconfiguredVerificationProvider,
    decodeNotification: unconfiguredNotificationDecoder,
    config: runtime.config,
    onPaymentSucceeded: runtime.accounting.wakePaymentAccounting,
  });
});
