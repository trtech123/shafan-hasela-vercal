import { createPelecardRefundHandler } from "../_shared/payment-refund.ts";
import { createPaymentEdgeRuntime, servePaymentHandler } from "../_shared/payment-edge-runtime.ts";
import { PaymentError } from "../_shared/payment-types.ts";

// The terminal-specific adjustment contract is intentionally absent until
// Pelecard confirms whether this account supports refund and/or void.
servePaymentHandler(() => {
  const enabled = Deno.env.get("PELECARD_REFUND_ENABLED")?.trim() === "true";
  const unavailable = async (): Promise<never> => {
    throw new PaymentError("capability_unconfigured");
  };
  if (!enabled) {
    const origins = Deno.env.get("PAYMENTS_APP_ORIGINS")?.split(",")
      .map((origin) => origin.trim()).filter(Boolean);
    if (!origins?.length) throw new Error("invalid_configuration");
    return createPelecardRefundHandler({
      auth: { authenticate: unavailable },
      store: {
        getOriginal: unavailable,
        reserve: unavailable,
        complete: unavailable,
      },
      provider: { adjust: unavailable },
      createAdjustmentId: () => crypto.randomUUID(),
      config: {
        allowedAppOrigins: origins,
        maxBodyBytes: 32_768,
        enabled: false,
      },
    });
  }

  const runtime = createPaymentEdgeRuntime();
  return createPelecardRefundHandler({
    auth: runtime.auth,
    store: {
      getOriginal: unavailable,
      reserve: unavailable,
      complete: unavailable,
    },
    provider: { adjust: unavailable },
    createAdjustmentId: () => crypto.randomUUID(),
    config: {
      allowedAppOrigins: runtime.config.allowedAppOrigins,
      maxBodyBytes: runtime.config.maxBodyBytes,
      enabled: true,
    },
  });
});
