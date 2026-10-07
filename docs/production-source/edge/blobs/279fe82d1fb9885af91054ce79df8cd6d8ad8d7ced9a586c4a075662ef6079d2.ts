export type StaffRole = "admin" | "operations" | "cashier";

export interface PaymentIdentity {
  id: string;
  role: string;
}

export interface PaymentAuthenticator {
  authenticate(accessToken: string): Promise<PaymentIdentity | null>;
}

const STAFF_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "operations",
  "cashier",
]);

export type PaymentAuthorizationResult =
  | { ok: true; identity: PaymentIdentity & { role: StaffRole } }
  | { ok: false; status: 401 | 403; code: "missing_authorization" | "invalid_session" | "forbidden" };

export async function authorizeStaff(
  request: Request,
  authenticator: PaymentAuthenticator,
): Promise<PaymentAuthorizationResult> {
  const header = request.headers.get("Authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return { ok: false, status: 401, code: "missing_authorization" };
  }

  let identity: PaymentIdentity | null;
  try {
    identity = await authenticator.authenticate(match[1]);
  } catch {
    identity = null;
  }

  if (!identity || !identity.id) {
    return { ok: false, status: 401, code: "invalid_session" };
  }
  if (!STAFF_ROLES.has(identity.role)) {
    return { ok: false, status: 403, code: "forbidden" };
  }

  return {
    ok: true,
    identity: identity as PaymentIdentity & { role: StaffRole },
  };
}
