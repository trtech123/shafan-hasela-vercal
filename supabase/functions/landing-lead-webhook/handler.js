const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max) => typeof value === 'string' && value.trim().length > 0 &&
  value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value)
  ? value.trim().replace(/\s+/g, ' ') : null;
const optional = (value, max) => value == null || value === '' ? null : clean(value, max);
const inquiryText = value => value == null || value === '' ? null :
  typeof value === 'string' && value.trim().length <= 2000 &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    ? value.trim().replace(/\r\n?/g, '\n') : null;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signLandingPayload(secret, timestamp, rawBody) {
  const bytes = await crypto.subtle.sign('HMAC', await hmacKey(secret),
    encoder.encode(`${timestamp}.${rawBody}`));
  return hex(new Uint8Array(bytes));
}

async function digest(secret, value) {
  const bytes = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(value));
  return hex(new Uint8Array(bytes));
}

async function validSignature(secret, timestamp, rawBody, header) {
  if (!/^sha256=[a-f0-9]{64}$/i.test(header ?? '')) return false;
  const expected = new Uint8Array((header.slice(7).match(/.{2}/g) ?? [])
    .map(pair => Number.parseInt(pair, 16)));
  return crypto.subtle.verify('HMAC', await hmacKey(secret), expected,
    encoder.encode(`${timestamp}.${rawBody}`));
}

function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 40 || /[^\d+\s().-]/.test(value)) return null;
  const digits = value.replace(/[\s().-]/g, '');
  const domestic = digits.startsWith('+972') ? `0${digits.slice(4)}` : digits;
  return /^0(?:5\d{8}|[2-9]\d{7,8})$/.test(domestic) ? domestic : null;
}

function normalizeEmail(value) {
  const email = clean(value, 320)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePayload(input, allowedForms, allowedHosts, now) {
  if (!object(input) || !object(input.fields) ||
    !allowedForms.includes(input.formId) || typeof input.pageUrl !== 'string')
    return { error: 'form_not_allowed', status: 403 };
  let page;
  try { page = new URL(input.pageUrl); } catch { return { error: 'form_not_allowed', status: 403 }; }
  if (page.protocol !== 'https:' || page.username || page.password || page.port ||
    !allowedHosts.includes(page.hostname.toLowerCase()))
    return { error: 'form_not_allowed', status: 403 };
  if (page.pathname.length > 1000)
    return { error: 'invalid_submission', status: 400 };
  const submitted = new Date(input.submittedAt);
  if (typeof input.submittedAt !== 'string' || !Number.isFinite(submitted.getTime()) ||
    submitted.getTime() > now.getTime() + 300_000 ||
    submitted.getTime() < now.getTime() - 7 * 86_400_000)
    return { error: 'invalid_submission', status: 400 };
  const fullName = clean(input.fields.name, 200);
  const phone = normalizePhone(input.fields.phone);
  const email = input.fields.email == null || input.fields.email === ''
    ? null : normalizeEmail(input.fields.email);
  const inquiry = inquiryText(input.inquiry);
  const company = optional(input.fields.company, 200);
  const topic = optional(input.topic, 200);
  if (!fullName || !phone || (input.fields.email != null && input.fields.email !== '' && !email) ||
    (input.inquiry != null && !inquiry) || (input.fields.company != null && !company) ||
    (input.topic != null && !topic) ||
    (input.formId === 'nurit-team-building' && !topic) ||
    input.fields.field_46ac48c || input.honeypot)
    return { error: 'invalid_submission', status: 400 };
  const utm = object(input.utm) ? input.utm : {};
  const getUtm = key => utm[key] ?? page.searchParams.get(`utm_${key}`);
  const attribution = { pagePath: page.pathname,
    pageUrl: `${page.origin}${page.pathname}`,
    sourceLabel: input.formId === 'nurit-team-building'
      ? 'קמפיין ממומן — יום גיבוש' : 'דף נחיתה — יום גיבוש', topic,
    campaign: optional(input.campaign, 200),
    utmSource: optional(getUtm('source'), 200), utmMedium: optional(getUtm('medium'), 200),
    utmCampaign: optional(getUtm('campaign'), 200), utmTerm: optional(getUtm('term'), 200),
    utmContent: optional(getUtm('content'), 200) };
  if (Object.values(attribution).some(value => value === undefined) ||
    (input.campaign != null && !attribution.campaign) ||
    (object(input.utm) && ['source', 'medium', 'campaign', 'term', 'content']
      .some(key => input.utm[key] != null && !attribution[`utm${key[0].toUpperCase()}${key.slice(1)}`])))
    return { error: 'invalid_submission', status: 400 };
  const submissionId = optional(input.submissionId, 128);
  if (!submissionId)
    return { error: 'invalid_submission', status: 400 };
  return { formId: input.formId, fullName, phone, email, company, inquiry,
    attribution, submittedDay: submitted.toISOString().slice(0, 10), submissionId };
}

export function createLandingLeadHandler({ enabled = false, secret,
  allowedForms = /** @type {string[]} */ ([]),
  allowedHosts = /** @type {string[]} */ ([]),
  ingest, now = () => new Date(), maxBodyBytes = 8192 }) {
  return async function landingLeadHandler(request) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!enabled || !secret || !allowedForms.length || !allowedHosts.length || !ingest)
      return json({ error: 'integration_disabled' }, 503);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return json({ error: 'invalid_content_type' }, 415);
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes)
      return json({ error: 'payload_too_large' }, 413);
    const rawBody = await request.text();
    if (encoder.encode(rawBody).byteLength > maxBodyBytes)
      return json({ error: 'payload_too_large' }, 413);
    const timestamp = request.headers.get('x-landing-timestamp') ?? '';
    if (!/^\d{10}$/.test(timestamp) ||
      Math.abs(now().getTime() - Number(timestamp) * 1000) > 300_000 ||
      !await validSignature(secret, timestamp, rawBody,
        request.headers.get('x-landing-signature')))
      return json({ error: 'invalid_signature' }, 401);
    let input;
    try { input = JSON.parse(rawBody); } catch { return json({ error: 'invalid_json' }, 400); }
    const lead = normalizePayload(input, allowedForms, allowedHosts, now());
    if (lead.error) return json({ error: lead.error }, lead.status);
    const submissionKey = await digest(secret, `${lead.formId}|${lead.submissionId}`);
    const contactKey = await digest(secret, lead.phone);
    try {
      const result = await ingest({ formId: lead.formId, submissionKey, contactKey,
        lead: { fullName: lead.fullName, phone: lead.phone, email: lead.email,
          company: lead.company, inquiry: lead.inquiry, source: 'landing_page',
          attribution: lead.attribution } });
      if (result.limited) return json({ error: 'rate_limited' }, 429);
      return json({ accepted: true, duplicate: !result.created });
    } catch {
      return json({ error: 'processing_failed' }, 500);
    }
  };
}
