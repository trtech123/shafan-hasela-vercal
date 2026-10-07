import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { readPelecardTestConfig } from "./pelecard-test-config.ts";
import { createPelecardTestProvider } from "./pelecard-test-provider.ts";
import { createPelecardTestStore } from "./pelecard-test-store.ts";
import { PaymentError } from "./payment-types.ts";
import { createPelecardTestInitAdapter, readTestInitTransport } from "./pelecard-test-init-adapter.ts";

export function createPelecardTestRuntime() {
  const read = (key: string) => Deno.env.get(key);
  const transport = readTestInitTransport(read);
  const required = (key: string) => {
    const value = read(key);
    if (!value) throw new PaymentError("invalid_configuration");
    return value;
  };
  const url = required("SUPABASE_URL");
  const client = createClient(url, required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    read,
    allowedOrigins: required("PAYMENTS_APP_ORIGINS").split(",").map((s) => s.trim()),
    feedbackUrl: `${url}/functions/v1/pelecard-test-feedback`,
    auth: {
      async authenticate(token: string) {
        const { data: { user }, error } = await client.auth.getUser(token);
        if (error || !user) return null;
        const { data, error: profileError } = await client.from("profiles").select("role").eq("id", user.id).single();
        if (profileError || !data) return null;
        return { id: user.id, role: data.role as string };
      },
    },
    store: createPelecardTestStore(client, transport),
    provider: () => createPelecardTestProvider(readPelecardTestConfig(read), fetch,
      transport === "node_v1" ? createPelecardTestInitAdapter(read) : undefined),
  };
}
