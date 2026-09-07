export const ICREDIT_TEST_BASE_URL = "https://testicredit.rivhit.co.il";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IcreditEventKind =
  | "agreement_created"
  | "charge_succeeded"
  | "charge_failed";

export type NormalizedIcreditIpn = {
  saleId: string;
  groupPrivateToken: string;
  agreementId: string;
  recurringId: string;
  chargeNumber: number;
  recurringCount: number;
  transactionParamJ: number;
  transactionStatus: number;
  transactionAmount: number;
  failureCode: string | null;
  failureMessage: string | null;
};

type EnrollmentInput = {
  groupPrivateToken: string;
  agreementId: string;
  clubName: string;
  amount: number;
  billingDay: number;
  startsOn: string;
  firstName?: string | null;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  redirectUrl: string;
  ipnUrl: string;
  failureIpnUrl: string;
};

function requireUuid(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!UUID_PATTERN.test(text)) throw new Error(`Invalid ${field}`);
  return text.toLowerCase();
}

function requireInteger(value: unknown, field: string, minimum = 0): number {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`Invalid ${field}`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}

function requireAmount(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid transaction amount");
  return Math.round(parsed * 100) / 100;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function requireHttpsUrl(value: string, field: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  return url.toString();
}

function toIcreditDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Invalid recurring start date");
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function buildEnrollmentRequest(input: EnrollmentInput) {
  const agreementId = requireUuid(input.agreementId, "agreementId");
  const groupPrivateToken = requireUuid(input.groupPrivateToken, "GroupPrivateToken");
  const amount = requireAmount(input.amount);
  if (amount <= 0) throw new Error("Recurring amount must be positive");
  const billingDay = requireInteger(input.billingDay, "billingDay", 1);
  if (billingDay > 28) throw new Error("billingDay must be between 1 and 28");
  const clubName = String(input.clubName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  if (!clubName || !lastName) throw new Error("Club and customer names are required");

  return {
    GroupPrivateToken: groupPrivateToken,
    Items: [{
      UnitPrice: amount,
      Quantity: 1,
      Description: `חברות חודשית - ${clubName}`.slice(0, 200),
    }],
    RedirectURL: requireHttpsUrl(input.redirectUrl, "RedirectURL"),
    IPNURL: requireHttpsUrl(input.ipnUrl, "IPNURL"),
    IPNFailureURL: requireHttpsUrl(input.failureIpnUrl, "IPNFailureURL"),
    IPNMethod: 1,
    CustomerFirstName: cleanText(input.firstName, 20) ?? "חבר",
    CustomerLastName: lastName.slice(0, 30),
    ...(cleanText(input.phone, 15) ? { PhoneNumber: cleanText(input.phone, 15) } : {}),
    ...(cleanText(input.email, 50) ? { EmailAddress: cleanText(input.email, 50) } : {}),
    Custom1: agreementId,
    Currency: 1,
    SendMail: false,
    CreateCustomer: false,
    CreateItems: false,
    CreateRecurringSale: true,
    SaleType: 2,
    RecurringSaleCycle: 3,
    RecurringSaleDay: billingDay,
    RecurringSaleStep: 1,
    RecurringSaleCount: 0,
    RecurringSaleStartDate: toIcreditDate(input.startsOn),
    RecurringSaleAutoCharge: true,
    RecurringSaleProRata: false,
    UniqueNum: agreementId.replaceAll("-", "").slice(0, 20),
    RequestReference: `club:${agreementId}`,
  };
}

export function normalizeIpn(input: Record<string, unknown>): NormalizedIcreditIpn {
  const saleId = requireUuid(input.SaleId, "SaleId");
  const groupPrivateToken = requireUuid(input.GroupPrivateToken, "GroupPrivateToken");
  const agreementId = requireUuid(input.Custom1, "Custom1");
  const recurringId = requireUuid(input.RecurringId, "RecurringId");
  const transactionStatus = requireInteger(input.TransactionStatus, "TransactionStatus");
  const failureDescription = cleanText(input.ErrorDescription, 500);
  const failureMessage = cleanText(input.ErrorMessage, 500) ?? failureDescription;

  return {
    saleId,
    groupPrivateToken,
    agreementId,
    recurringId,
    chargeNumber: requireInteger(input.RecurringSaleChargeNumber, "RecurringSaleChargeNumber"),
    recurringCount: requireInteger(input.RecurringSaleCount ?? 0, "RecurringSaleCount"),
    transactionParamJ: requireInteger(input.TransactionParamJ, "TransactionParamJ"),
    transactionStatus,
    transactionAmount: requireAmount(input.TransactionAmount),
    failureCode: transactionStatus === 0
      ? null
      : cleanText(input.ErrorCode, 100) ?? String(transactionStatus),
    failureMessage: transactionStatus === 0 ? null : failureMessage,
  };
}

export function classifyIpn(event: NormalizedIcreditIpn): IcreditEventKind {
  if (event.chargeNumber === 0 && event.transactionParamJ === 5) {
    return "agreement_created";
  }
  if (event.chargeNumber > 0 && event.transactionParamJ === 0 && event.transactionStatus === 0) {
    return "charge_succeeded";
  }
  if (
    event.chargeNumber > 0 &&
    (event.transactionStatus !== 0 || Boolean(event.failureCode) || Boolean(event.failureMessage))
  ) {
    return "charge_failed";
  }
  throw new Error("Unsupported recurring IPN state");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`iCredit returned an unreadable response (${response.status})`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("iCredit returned an invalid response");
  }
  return data as Record<string, unknown>;
}

export async function verifyIpn(
  fetcher: typeof fetch,
  input: {
    groupPrivateToken: string;
    event: NormalizedIcreditIpn;
    expectedAmount: number;
  },
): Promise<true> {
  const configuredToken = requireUuid(input.groupPrivateToken, "configured GroupPrivateToken");
  if (input.event.groupPrivateToken !== configuredToken) {
    throw new Error("Unexpected payment page identifier");
  }
  const expectedAmount = requireAmount(input.expectedAmount);
  if (Math.round(input.event.transactionAmount * 100) !== Math.round(expectedAmount * 100)) {
    throw new Error("IPN amount does not match the local membership");
  }

  const response = await fetcher(
    `${ICREDIT_TEST_BASE_URL}/API/PaymentPageRequest.svc/Verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        GroupPrivateToken: configuredToken,
        SaleId: input.event.saleId,
        TotalAmount: expectedAmount,
      }),
    },
  );
  const data = await readJson(response);
  if (!response.ok || String(data.Status ?? "").toUpperCase() !== "VERIFIED") {
    throw new Error("iCredit IPN was not verified");
  }
  return true;
}

export async function createEventDigest(
  event: NormalizedIcreditIpn,
  kind: IcreditEventKind,
): Promise<string> {
  const canonical = [
    kind,
    event.saleId,
    event.agreementId,
    event.recurringId,
    event.chargeNumber,
    event.recurringCount,
    event.transactionParamJ,
    event.transactionStatus,
    event.transactionAmount.toFixed(2),
    event.failureCode ?? "",
    event.failureMessage ?? "",
  ].join("|");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readEnrollmentResponse(data: Record<string, unknown>): string {
  if (Number(data.Status) !== 0) {
    throw new Error(cleanText(data.DebugMessage, 500) ?? "iCredit enrollment failed");
  }
  const url = new URL(String(data.URL ?? ""));
  if (url.protocol !== "https:" || url.hostname !== "testicredit.rivhit.co.il") {
    throw new Error("iCredit did not return a TEST hosted payment URL");
  }
  return url.toString();
}

export async function cancelRecurringSale(
  fetcher: typeof fetch,
  recurringId: string,
): Promise<true> {
  const response = await fetcher(
    `${ICREDIT_TEST_BASE_URL}/API/PaymentPageRequest.svc/RecurringSaleCancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RecurringSaleId: requireUuid(recurringId, "RecurringSaleId") }),
    },
  );
  const data = await readJson(response);
  if (!response.ok || Number(data.Status) !== 0) {
    throw new Error(cleanText(data.DebugMessage, 500) ?? "iCredit recurring sale was not cancelled");
  }
  return true;
}
