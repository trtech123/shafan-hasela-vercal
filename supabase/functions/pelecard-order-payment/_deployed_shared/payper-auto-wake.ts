/** Best-effort wake after durable payment finalization. The ledger is the outbox. */
export function createPayperAutoWake(options: {
  read(name: string): string | undefined;
  fetcher?: typeof fetch;
  log(event: Record<string, unknown>): void;
}) {
  return async (paymentId: string): Promise<void> => {
    if (options.read("PAYPER_AUTO_WAKE_ENABLED") !== "true" ||
      options.read("PAYPER_DISPATCH_ENABLED") !== "true") return;
    const token = options.read("PAYPER_WORKER_TOKEN")?.trim();
    const base = options.read("SUPABASE_URL");
    let endpoint: URL;
    try {
      endpoint = new URL(base ?? "");
      if (endpoint.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname) ||
        endpoint.username || endpoint.password ||
        endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.port ||
        !token || token.length < 16 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId))
        throw new Error("invalid_configuration");
    } catch {
      options.log({ event: "payper_auto_wake_configuration_required" });
      return;
    }
    endpoint.pathname = "/functions/v1/payper-issuance-worker";
    try {
      const response = await (options.fetcher ?? fetch)(endpoint.href, {
        method: "POST", signal: AbortSignal.timeout(25_000), headers: {
          authorization: `Bearer ${token}`,
          "x-payper-target-payment-id": paymentId,
        },
      });
      if (!response.ok) options.log({ event: "payper_auto_wake_failed", status: response.status });
    } catch {
      // No retry here. The eligible ledger row remains visible to operations.
      options.log({ event: "payper_auto_wake_failed", status: "transport" });
    }
  };
}
