import { PaymentError } from "./payment-types.ts";

export type ReadEnvironment = (name: string) => string | undefined;

export interface PelecardTestConfig {
  readonly mode: "test";
  readonly user: string;
  readonly password: string;
  readonly terminal: string;
}

export function assertPelecardTestMode(read: ReadEnvironment): void {
  if (read("PELECARD_MODE") !== "test") {
    throw new PaymentError("capability_disabled");
  }
}

export function readPelecardTestConfig(read: ReadEnvironment): PelecardTestConfig {
  // Check mode before accessing any credential. Deliberately no LIVE branch.
  assertPelecardTestMode(read);
  const required = (name: string): string => {
    const value = read(name);
    if (!value || value.trim() !== value) throw new PaymentError("invalid_configuration");
    return value;
  };
  return {
    mode: "test",
    user: required("PELECARD_TEST_USER"),
    password: required("PELECARD_TEST_PASSWORD"),
    terminal: required("PELECARD_TEST_TERMINAL"),
  };
}

/** No mode or secret can enable commercial execution during TEST activation. */
export function assertCommercialPaymentsDisabled(): void {
  throw new PaymentError("capability_disabled");
}
