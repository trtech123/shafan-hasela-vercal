import { createClient } from "npm:@supabase/supabase-js@2.45.0";

import type {
  PaymentAuthenticator,
  PaymentIdentity,
} from "../_shared/payment-auth.ts";
import {
  createPelecardInitiateHandler,
} from "../_shared/payment-initiation.ts";
import { createSupabasePaymentStore } from "../_shared/payment-store.ts";
import { createPelecardClient } from "../_shared/pelecard-client.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("invalid_configuration");
  return value;
}

function runtimeHandler() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedAppOrigins = requireEnv("PAYMENTS_APP_ORIGINS").split(",");
  const allowedProviderRedirectOrigins = requireEnv(
    "PELECARD_REDIRECT_ORIGINS",
  ).split(",");

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

  // Intentionally fail closed: Pelecard's initiation request/response mapping
  // must be injected only after its written terminal-specific contract is known.
  const provider = createPelecardClient({
    allowedRedirectOrigins: allowedProviderRedirectOrigins,
    capabilities: {},
  });

  return createPelecardInitiateHandler({
    auth,
    provider,
    store: createSupabasePaymentStore(serviceClient),
    createPaymentId: () => crypto.randomUUID(),
    config: {
      allowedAppOrigins,
      allowedProviderRedirectOrigins,
      returnUrl: requireEnv("PAYMENTS_RETURN_URL"),
      callbackUrl: requireEnv("PAYMENTS_CALLBACK_URL"),
      currencyCode: "ILS",
      maxBodyBytes: 32_768,
    },
  });
}

Deno.serve(async (request: Request) => {
  try {
    return await runtimeHandler()(request);
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
