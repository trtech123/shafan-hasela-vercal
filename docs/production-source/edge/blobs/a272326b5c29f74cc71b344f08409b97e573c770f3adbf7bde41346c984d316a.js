export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class DeliveryError extends Error {
  constructor(code, status = 400, state = null) { super(code); this.code = code; this.status = status; this.state = state; }
}
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
} });
export async function boundedOperation(operation, timeoutMs = 15000, code = 'provider_timeout') {
  const controller = new AbortController(); let timer;
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new DeliveryError(code, 504, 'uncertain')); controller.abort(); }, timeoutMs);
  })]); } finally { clearTimeout(timer); }
}
export async function readJson(request, maxBytes = MAX_REQUEST_BYTES, timeoutMs = 10000) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new DeliveryError('request_too_large', 413);
  if (!request.body) throw new DeliveryError('invalid_request');
  return boundedOperation(async (signal) => {
    const reader = request.body.getReader(); const chunks = []; let total = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try { while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > maxBytes) { cancel(); throw new DeliveryError('request_too_large', 413); }
      chunks.push(value);
    } } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
    catch { throw new DeliveryError('invalid_request'); }
  }, timeoutMs, 'request_timeout');
}
export function decodePdf(value) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new DeliveryError('invalid_pdf');
  let binary; try { binary = atob(value); } catch { throw new DeliveryError('invalid_pdf'); }
  if (binary.length > MAX_PDF_BYTES) throw new DeliveryError('pdf_too_large', 413);
  if (!binary.startsWith('%PDF-') || !binary.slice(-1024).includes('%%EOF')) throw new DeliveryError('invalid_pdf');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export async function validateSendRequest(body) {
  if (!['send','manual_resend'].includes(body.action) || Object.keys(body).some(key => !['action', 'requestId', 'quoteId', 'revisionId', 'pdfBase64', 'fileName','resendOf','confirmed'].includes(key)) || !['requestId', 'quoteId', 'revisionId'].every(key => typeof body[key] === 'string' && UUID.test(body[key])) || (body.fileName !== undefined && (typeof body.fileName !== 'string' || body.fileName.length > 200)) || (body.action==='manual_resend' ? (typeof body.resendOf!=='string' || !UUID.test(body.resendOf) || body.resendOf.toLowerCase()===body.requestId?.toLowerCase() || body.confirmed!==true) : body.resendOf!==undefined || body.confirmed!==undefined)) throw new DeliveryError('invalid_request');
  const pdfBytes = decodePdf(body.pdfBase64);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pdfBytes));
  return { resendOf:body.action==='manual_resend'?body.resendOf.toLowerCase():null, requestId: body.requestId.toLowerCase(), quoteId: body.quoteId.toLowerCase(), revisionId: body.revisionId.toLowerCase(), pdfBytes, pdfHash: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') };
}
export function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value); }
export function normalizeQuotationPhone(raw) {
  if (typeof raw !== 'string' || raw.length < 7 || raw.length > 40 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const value = raw.trim();
  if (!/^\+?[\d ()-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+') && digits.startsWith('0')) return null;
  const normalized = digits.startsWith('00972') ? digits.slice(2) : digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  if (normalized.startsWith('972')) return /^972(?:5\d{8}|[23489]\d{7}|7\d{8})$/.test(normalized) ? normalized : null;
  return /^[1-9]\d{8,14}$/.test(normalized) ? normalized : null;
}
export function destinationFor(channel, revision) {
  if (channel === 'email') { const value = typeof revision.client_email === 'string' ? revision.client_email.trim() : ''; if (!validEmail(value)) throw new DeliveryError('invalid_saved_email', 422); return value; }
  const normalized = normalizeQuotationPhone(revision.client_phone);
  if (!normalized) throw new DeliveryError('invalid_saved_phone', 422);
  return normalized;
}
export function revisionForMessage(revision) {
  if (!revision || typeof revision.client_name !== 'string' || !revision.client_name.trim() || revision.client_name.length > 300 || /[\u0000-\u001f\u007f]/.test(revision.client_name) || typeof revision.quote_number !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(revision.quote_number)) throw new DeliveryError('invalid_saved_quotation', 422);
  return { clientName: revision.client_name, quoteNumber: revision.quote_number, fileName: `quotation-${revision.quote_number}.pdf` };
}
export function safeProviderId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:@+\/=<>-]{1,300}$/.test(value) ? value : null; }
export function publicAttempt(row) {
  const keys = ['id', 'quote_id', 'revision_id', 'channel', 'destination', 'state', 'reason', 'provider_message_id', 'pdf_sha256', 'created_at', 'dispatched_at', 'finished_at','resend_of','attempt_type'];
  return Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
}
