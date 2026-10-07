import { createPaymentAccountingWorkerHandler } from "./_deployed_shared/payment-accounting/worker-handler.ts";
import {
  createPaymentAccountingEdgeRuntime,
  servePaymentHandler,
} from "./_deployed_shared/payment-edge-runtime.ts";

servePaymentHandler(() => {
  const runtime = createPaymentAccountingEdgeRuntime();
  return createPaymentAccountingWorkerHandler({
    auth: runtime.auth,
    processEvent: runtime.accounting.processEvent,
    allowedAppOrigins: runtime.allowedAppOrigins,
    maxBodyBytes: 4_096,
  });
});
