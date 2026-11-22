const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export function createRivhitJournalHandler(dependencies: {
  serviceKey: string;
  enabled: boolean;
  process: (entryId: string) => Promise<string>;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ') || !equalSecret(header.slice(7), dependencies.serviceKey)) {
      return json({ error: 'authentication_required' }, 401);
    }
    if (!dependencies.enabled) return json({ error: 'journal_posting_disabled' }, 503);
    if (Number(request.headers.get('Content-Length')) > 1024) return json({ error: 'invalid_request' }, 400);
    let input: unknown;
    try {
      const body = await request.text();
      if (body.length > 1024) return json({ error: 'invalid_request' }, 400);
      input = JSON.parse(body);
    } catch { return json({ error: 'invalid_request' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 1 || !('entryId' in input)
      || typeof input.entryId !== 'string' || !UUID.test(input.entryId)) {
      return json({ error: 'invalid_request' }, 400);
    }
    try {
      const result = await dependencies.process(input.entryId);
      return json({ result }, ['uncertain', 'reconciliation_required', 'existing_match'].includes(result) ? 409 : 200);
    } catch {
      return json({ error: 'journal_processing_failed' }, 500);
    }
  };
}
