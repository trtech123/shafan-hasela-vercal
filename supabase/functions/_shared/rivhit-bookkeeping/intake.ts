interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
}

interface IntakeEnvironment { RIVHIT_BOOKKEEPING_INTAKE_ENABLED?: string }

/** Sidecar to the Payper success ledger; never changes the issuance result. */
export function createPayperBookkeepingIntakeObserver(
  client: RpcClient, environment: IntakeEnvironment,
) {
  return {
    async capture(paymentId: string, payperState: string): Promise<
      { status: "disabled" | "not_succeeded" | "capture_unavailable" } |
      { status: "held"; intakeId: string }
    > {
      if (environment.RIVHIT_BOOKKEEPING_INTAKE_ENABLED !== "true")
        return { status: "disabled" };
      if (payperState !== "succeeded") return { status: "not_succeeded" };
      if (!paymentId) return { status: "capture_unavailable" };
      try {
        const result = await client.rpc("capture_succeeded_payper_bookkeeping_intake",
          { p_payment_id: paymentId });
        if (result.error || typeof result.data !== "string" || !result.data)
          return { status: "capture_unavailable" };
        return { status: "held", intakeId: result.data };
      } catch { return { status: "capture_unavailable" }; }
    },
  };
}
