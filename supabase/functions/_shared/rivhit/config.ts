import type { DocumentMapping } from "./types.ts";

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function requiredBoolean(
  key: string,
  mapping: Record<string, unknown>,
  field: "price_include_vat" | "send_mail" | "digital_signature",
): boolean {
  const value = mapping[field];
  if (typeof value !== "boolean") {
    throw new Error(`Invalid Rivhit mapping "${key}": ${field}`);
  }
  return value;
}

function validateMapping(key: string, value: unknown): DocumentMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Rivhit mapping "${key}": mapping`);
  }

  const mapping = value as Record<string, unknown>;
  if (!isIntegerInRange(mapping.document_type, 1, 999)) {
    throw new Error(`Invalid Rivhit mapping "${key}": document_type`);
  }
  if (!isIntegerInRange(mapping.sort_code, 0, 999)) {
    throw new Error(`Invalid Rivhit mapping "${key}": sort_code`);
  }
  if (!isIntegerInRange(mapping.currency_id, 1, 10)) {
    throw new Error(`Invalid Rivhit mapping "${key}": currency_id`);
  }
  return {
    document_type: mapping.document_type,
    sort_code: mapping.sort_code,
    currency_id: mapping.currency_id,
    price_include_vat: requiredBoolean(key, mapping, "price_include_vat"),
    send_mail: requiredBoolean(key, mapping, "send_mail"),
    digital_signature: requiredBoolean(key, mapping, "digital_signature"),
  };
}

export function parseDocumentTypeMap(
  raw: string | undefined,
): Record<string, DocumentMapping> {
  if (!raw) {
    throw new Error("RIVHIT_DOCUMENT_TYPE_MAP is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("RIVHIT_DOCUMENT_TYPE_MAP is invalid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("RIVHIT_DOCUMENT_TYPE_MAP must be a JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, validateMapping(key, value)]),
  );
}

export function getDocumentMapping(
  mappings: Record<string, DocumentMapping>,
  key: string,
): DocumentMapping {
  const mapping = mappings[key];
  if (!mapping) {
    throw new Error(`Rivhit document mapping "${key}" is not configured`);
  }
  return mapping;
}
