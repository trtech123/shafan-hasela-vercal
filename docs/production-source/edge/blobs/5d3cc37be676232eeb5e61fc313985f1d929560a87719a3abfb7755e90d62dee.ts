export class PaymentHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "PaymentHttpError";
    this.status = status;
    this.code = code;
  }
}

function configuredOrigins(origins: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new PaymentHttpError(500, "invalid_configuration");
  }

  const normalized = new Set<string>();
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new PaymentHttpError(500, "invalid_configuration");
    }
    if (
      parsed.protocol !== "https:" || parsed.origin !== origin ||
      parsed.pathname !== "/" || parsed.search || parsed.hash ||
      parsed.username || parsed.password
    ) {
      throw new PaymentHttpError(500, "invalid_configuration");
    }
    normalized.add(origin);
  }
  return normalized;
}

export function paymentCorsHeaders(
  request: Request,
  allowedOrigins: readonly string[],
): HeadersInit {
  const allowed = configuredOrigins(allowedOrigins);
  const origin = request.headers.get("Origin");
  if (origin !== null && !allowed.has(origin)) {
    throw new PaymentHttpError(403, "origin_forbidden");
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function paymentJson(
  body: unknown,
  status: number,
  corsHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

async function readPaymentText(
  request: Request,
  maxBodyBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new PaymentHttpError(500, "invalid_configuration");
  }

  const advertisedSize = request.headers.get("Content-Length");
  if (advertisedSize !== null) {
    const size = Number(advertisedSize);
    if (!Number.isFinite(size) || size < 0) {
      throw new PaymentHttpError(400, "invalid_request");
    }
    if (size > maxBodyBytes) {
      throw new PaymentHttpError(413, "body_too_large");
    }
  }

  if (!request.body) throw new PaymentHttpError(400, "invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      try {
        await reader.cancel();
      } catch {
        // The size violation is authoritative; do not expose stream details.
      }
      throw new PaymentHttpError(413, "body_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PaymentHttpError(400, "invalid_json");
  }
}

function paymentContentType(request: Request): string {
  return request.headers.get("Content-Type")?.split(";", 1)[0]
    .trim().toLowerCase() ?? "";
}

export async function parsePaymentBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ contentType: string; body: unknown }> {
  const contentType = paymentContentType(request);
  if (contentType !== "application/json" &&
    contentType !== "application/x-www-form-urlencoded") {
    throw new PaymentHttpError(415, "unsupported_media_type");
  }

  const text = await readPaymentText(request, maxBodyBytes);
  if (contentType === "application/json") {
    try {
      return { contentType, body: JSON.parse(text) };
    } catch {
      throw new PaymentHttpError(400, "invalid_json");
    }
  }

  const body: Record<string, string> = {};
  const params = new URLSearchParams(text);
  for (const [key, value] of params) {
    if (Object.hasOwn(body, key)) {
      throw new PaymentHttpError(400, "invalid_input");
    }
    body[key] = value;
  }
  return { contentType, body };
}

export async function parsePaymentJson(
  request: Request,
  maxBodyBytes: number,
): Promise<unknown> {
  if (paymentContentType(request) !== "application/json") {
    throw new PaymentHttpError(415, "unsupported_media_type");
  }
  const text = await readPaymentText(request, maxBodyBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new PaymentHttpError(400, "invalid_json");
  }
}
