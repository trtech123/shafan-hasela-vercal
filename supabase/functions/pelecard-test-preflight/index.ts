import { createTestPreflightHandler } from "../_shared/pelecard-test-preflight.ts";
import { readPelecardTestConfig } from "../_shared/pelecard-test-config.ts";
import { createPelecardTestProvider } from "../_shared/pelecard-test-provider.ts";

const read = (key: string) => Deno.env.get(key);
Deno.serve(createTestPreflightHandler({
  read,
  preflight: () => createPelecardTestProvider(readPelecardTestConfig(read)).preflight(),
}));
