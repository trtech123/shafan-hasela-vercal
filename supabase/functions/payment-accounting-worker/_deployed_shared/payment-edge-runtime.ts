import { createClient } from "npm:@supabase/supabase-js@2.45.0";

import type {
  PaymentAuthenticator,
  PaymentIdentity,
} from "./payment-auth.ts";
import type {
  PaymentHandlerConfig,
  PaymentNotificationDecoder,
  PaymentVerificationProvider,
} from "../../_shared/payment-handlers.ts";
import { PaymentError } from "./payment-types.ts";
import { createSupabasePaymentVerificationStore } from "./payment-store.ts";
import { createPaymentAccountingRuntime } from "./payment-accounting/runtime.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("invalid_configuration");
  return value;
}

function commaList(name: string): string[] {
  const values = requireEnv(name).split(",").map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error("invalid_configuration");
  return values;
}

function accountingEnv() {
  return {
    RIVHIT_API_TOKEN: Deno.env.get("RIVHIT_API_TOKEN"),
    RIVHIT_ACCOUNTING_MODE: Deno.env.get("RIVHIT_ACCOUNTING_MODE"),
    RIVHIT_ACCOUNT_NAMESPACE: Deno.env.get("RIVHIT_ACCOUNT_NAMESPACE"),
    RIVHIT_DOCUMENT_TYPE_MAP: Deno.env.get("RIVHIT_DOCUMENT_TYPE_MAP"),
  };
}

function createSupabaseEdgeRuntime() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const auth: PaymentAuthenticator = {
    async authenticate(accessToken): Promise<PaymentIdentity | null> {
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: { user }, error: userError } = await callerClient.auth
        .getUser(accessToken);
      if (userError || !user) return null;
      const { data: profile, error: profileError } = await callerClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (profileError || !profile || typeof profile.role !== "string") {
        return null;
      }
      return { id: user.id, role: profile.role };
    },
  };

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { auth, serviceClient };
}

export function createPaymentEdgeRuntime() {
  const { auth, serviceClient } = createSupabaseEdgeRuntime();
  const config: PaymentHandlerConfig = {
    allowedAppOrigins: commaList("PAYMENTS_APP_ORIGINS"),
    maxBodyBytes: 32_768,
    terminalReference: requireEnv("PELECARD_TERMINAL"),
    successfulProviderStatusCodes: commaList(
      "PELECARD_SUCCESS_STATUS_CODES",
    ),
  };
  return {
    auth,
    config,
    store: createSupabasePaymentVerificationStore(serviceClient),
    accounting: createPaymentAccountingRuntime({
      serviceClient,
      env: accountingEnv(),
    }),
  };
}

export function createPaymentAccountingEdgeRuntime() {
  const { auth, serviceClient } = createSupabaseEdgeRuntime();
  return {
    auth,
    allowedAppOrigins: commaList("PAYMENTS_APP_ORIGINS"),
    accounting: createPaymentAccountingRuntime({
      serviceClient,
      env: accountingEnv(),
    }),
  };
}

export const unconfiguredNotificationDecoder: PaymentNotificationDecoder =
  () => {
    throw new PaymentError("capability_unconfigured");
  };

export const unconfiguredVerificationProvider: PaymentVerificationProvider = {
  async validateConfirmation() {
    throw new PaymentError("capability_unconfigured");
  },
  async lookup() {
    throw new PaymentError("capability_unconfigured");
  },
};

export function servePaymentHandler(
  createHandler: () => (request: Request) => Promise<Response>,
): void {
  Deno.serve(async (request: Request) => {
    try {
      return await createHandler()(request);
    } catch {
      return new Response(JSON.stringify({
        error: { code: "invalid_configuration" },
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  });
}
