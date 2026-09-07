import { createPelecardStatusHandler } from "../_shared/payment-handlers.ts";
import {
  createPaymentEdgeRuntime,
  servePaymentHandler,
} from "../_shared/payment-edge-runtime.ts";

servePaymentHandler(() => {
  const runtime = createPaymentEdgeRuntime();
  return createPelecardStatusHandler({
    auth: runtime.auth,
    store: runtime.store,
    config: runtime.config,
  });
});
