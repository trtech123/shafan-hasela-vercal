import { describe, expect, test, vi } from 'vitest';
import { createLandingLeadHandler, signLandingPayload } from '../../../supabase/functions/landing-lead-webhook/handler.js';

const secret = 'synthetic-secret-for-tests-only-1234567890';
const now = new Date('2026-11-16T10:00:00.000Z');
const payload = {
  formId: '10db6ba', pageUrl: 'https://www.shafan-hasela.com/he/?utm_source=search',
  submittedAt: now.toISOString(),
  fields: { name: 'Test Customer', phone: '+972-50-123-4567', email: 'TEST@EXAMPLE.INVALID' },
  inquiry: 'Group activity', campaign: 'winter', submissionId: 'submission-1',
  utm: { source: 'search', medium: 'cpc', campaign: 'winter' },
};

async function request(body = payload, options = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = await signLandingPayload(secret, timestamp, raw);
  return new Request('https://example.test/functions/v1/landing-lead-webhook', {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-landing-timestamp': timestamp, 'x-landing-signature': `sha256=${signature}`,
      ...options.headers }, body: raw,
  });
}

function handler(ingest = vi.fn().mockResolvedValue({ created: true, leadId: 'lead-1' }), overrides = {}) {
  return { ingest, run: createLandingLeadHandler({ enabled: true, secret,
    allowedForms: ['10db6ba'], allowedHosts: ['www.shafan-hasela.com'],
    now: () => now, ingest, ...overrides }) };
}

describe('signed landing lead receiver', () => {
  test('normalizes a verified form submission and preserves source and attribution', async () => {
    const { run, ingest } = handler();
    const response = await run(await request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, duplicate: false });
    expect(ingest).toHaveBeenCalledOnce();
    const input = ingest.mock.calls[0][0];
    expect(input.lead).toMatchObject({ fullName: 'Test Customer', phone: '0501234567',
      email: 'test@example.invalid', inquiry: 'Group activity', source: 'landing_page',
      attribution: { pagePath: '/he/', pageUrl: 'https://www.shafan-hasela.com/he/',
        sourceLabel: 'דף נחיתה — יום גיבוש', campaign: 'winter', utmSource: 'search',
        utmMedium: 'cpc', utmCampaign: 'winter' } });
    expect(input.submissionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(input.contactKey).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects missing contact fields and malformed values before persistence', async () => {
    const { run, ingest } = handler();
    for (const fields of [
      { name: '', phone: '0501234567', email: 'test@example.invalid' },
      { name: 'Test Customer', phone: 'abc', email: 'test@example.invalid' },
      { name: 'Test Customer', phone: '0501234567', email: 'invalid' },
    ]) {
      const response = await run(await request({ ...payload, fields }));
      expect(response.status).toBe(400);
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  test('accepts the actual Base44 form without email and retains its topic', async () => {
    const { run, ingest } = handler(undefined, {
      allowedForms: ['nurit-team-building'],
      allowedHosts: ['vegan-climb-the-summit.base44.app'],
    });
    const response = await run(await request({
      formId: 'nurit-team-building', submittedAt: now.toISOString(),
      pageUrl: 'https://vegan-climb-the-summit.base44.app/',
      fields: { name: 'Test Customer', phone: '0501234567' },
      topic: 'יום גיבוש לחברות', inquiry: '20 participants', submissionId: 'base44-uuid-1',
    }));
    expect(response.status).toBe(200);
    expect(ingest.mock.calls[0][0].lead).toMatchObject({ email: null,
      attribution: { pageUrl: 'https://vegan-climb-the-summit.base44.app/',
        sourceLabel: 'קמפיין ממומן — יום גיבוש', topic: 'יום גיבוש לחברות' } });
  });

  test('requires a topic from the Base44 campaign form', async () => {
    const { run, ingest } = handler(undefined, {
      allowedForms: ['nurit-team-building'],
      allowedHosts: ['vegan-climb-the-summit.base44.app'],
    });
    const response = await run(await request({
      formId: 'nurit-team-building', submittedAt: now.toISOString(),
      pageUrl: 'https://vegan-climb-the-summit.base44.app/',
      fields: { name: 'Test Customer', phone: '0501234567' },
      submissionId: 'base44-uuid-2',
    }));
    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  test('uses one form identity for both Base44 placements and deduplicates a replay', async () => {
    const seen = new Set();
    const ingest = vi.fn(async ({ submissionKey }) => {
      const created = !seen.has(submissionKey);
      seen.add(submissionKey);
      return { created, leadId: 'synthetic-lead' };
    });
    const { run } = handler(ingest, {
      allowedForms: ['nurit-team-building'],
      allowedHosts: ['vegan-climb-the-summit.base44.app'],
    });
    const base44 = { formId: 'nurit-team-building', submittedAt: now.toISOString(),
      pageUrl: 'https://vegan-climb-the-summit.base44.app/',
      fields: { name: 'Synthetic Visitor', phone: '0501234567' },
      topic: 'יום גיבוש לחברות' };
    const hero = await (await run(await request({ ...base44,
      placement: 'hero', submissionId: 'synthetic-a' }))).json();
    const footer = await (await run(await request({ ...base44,
      placement: 'footer', submissionId: 'synthetic-b' }))).json();
    const replay = await (await run(await request({ ...base44,
      placement: 'footer', submissionId: 'synthetic-a' }))).json();
    expect([hero.duplicate, footer.duplicate, replay.duplicate]).toEqual([false, false, true]);
    expect(seen.size).toBe(2);
  });

  test('requires a stable submission ID and uses the phone for contact rate limiting', async () => {
    const { run, ingest } = handler();
    expect((await run(await request({ ...payload, submissionId: undefined }))).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
    await run(await request({ ...payload, fields: { name: 'Test Customer', phone: '0501234567' } }));
    expect(ingest.mock.calls[0][0].contactKey).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects unsigned, stale, unapproved form, unapproved host and disabled requests', async () => {
    const { run, ingest } = handler();
    expect((await run(await request(payload, { headers: { 'x-landing-signature': 'sha256=bad' } }))).status).toBe(401);
    expect((await run(await request({ ...payload, formId: 'other' }))).status).toBe(403);
    expect((await run(await request({ ...payload, pageUrl: 'https://other.example/' }))).status).toBe(403);
    expect((await handler(ingest, { enabled: false }).run(await request())).status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  test('returns duplicate and rate-limit results without exposing lead data', async () => {
    const duplicate = handler(vi.fn().mockResolvedValue({ created: false, leadId: 'lead-1' }));
    expect(await (await duplicate.run(await request())).json()).toEqual({ accepted: true, duplicate: true });
    const limited = handler(vi.fn().mockResolvedValue({ limited: true }));
    const response = await limited.run(await request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
  });

  test('reports storage failure without claiming that a lead was saved', async () => {
    const { run } = handler(vi.fn().mockRejectedValue(new Error('synthetic database outage')));
    const response = await run(await request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'processing_failed' });
  });

  test('keeps URL-only UTM attribution and a multiline inquiry', async () => {
    const { run, ingest } = handler();
    const response = await run(await request({ ...payload, utm: undefined, campaign: undefined,
      inquiry: 'Group activity\nTwenty participants' }));
    expect(response.status).toBe(200);
    expect(ingest.mock.calls[0][0].lead).toMatchObject({
      inquiry: 'Group activity\nTwenty participants',
      attribution: { utmSource: 'search' },
    });
  });

  test('rejects stale signatures and nonempty honeypot fields', async () => {
    const ingest = vi.fn();
    const stale = handler(ingest, { now: () => new Date(now.getTime() + 600_000) });
    expect((await stale.run(await request())).status).toBe(401);
    const active = handler(ingest);
    expect((await active.run(await request({ ...payload,
      fields: { ...payload.fields, field_46ac48c: 'bot' } }))).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  test('rejects an oversized page path before the database RPC', async () => {
    const { run, ingest } = handler();
    const response = await run(await request({ ...payload,
      pageUrl: `https://www.shafan-hasela.com/${'a'.repeat(1100)}` }));
    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
});
