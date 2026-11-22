import { describe, expect, test, vi } from 'vitest';
import { createRivhitJournalHandler } from './handler.ts';

const id = '00000000-0000-4000-8000-000000000001';
function request(token?: string, body = JSON.stringify({ entryId: id })) {
  return new Request('https://example.invalid/rivhit-journal-worker', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body,
  });
}

describe('private journal worker', () => {
  test('rejects missing or incorrect service credentials without touching the outbox', async () => {
    const process = vi.fn();
    const handler = createRivhitJournalHandler({ serviceKey: 'secret-test-key', enabled: true, process });
    expect((await handler(request())).status).toBe(401);
    expect((await handler(request('wrong'))).status).toBe(401);
    expect(process).not.toHaveBeenCalled();
  });

  test('cannot post while the separate activation flag is disabled', async () => {
    const process = vi.fn();
    const handler = createRivhitJournalHandler({ serviceKey: 'secret-test-key', enabled: false, process });
    expect((await handler(request('secret-test-key'))).status).toBe(503);
    expect(process).not.toHaveBeenCalled();
  });

  test('processes one strict authenticated request', async () => {
    const process = vi.fn().mockResolvedValue('already_claimed');
    const handler = createRivhitJournalHandler({ serviceKey: 'secret-test-key', enabled: true, process });
    expect((await handler(request('secret-test-key'))).status).toBe(200);
    expect(process).toHaveBeenCalledOnce();
    expect(process).toHaveBeenCalledWith(id);
    expect((await handler(request('secret-test-key', '{}'))).status).toBe(400);
  });
});
