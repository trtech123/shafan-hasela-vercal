export async function createRequestReference(accountNamespace: string,
  sourceDocumentId: string, legKind: string, correctionSequence: number): Promise<string> {
  if (!accountNamespace.trim() || !sourceDocumentId.trim() || !legKind.trim()
    || !Number.isSafeInteger(correctionSequence) || correctionSequence < 0)
    throw new Error("invalid_journal_identity");
  const tuple = JSON.stringify([accountNamespace, "payper", sourceDocumentId,
    legKind, correctionSequence]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tuple));
  return "shafan-jr-" + Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")).join("");
}
