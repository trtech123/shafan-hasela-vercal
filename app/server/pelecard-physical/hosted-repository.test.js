import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalRepository } from './repository.js';

const id = '11111111-1111-4111-8111-111111111111';
test('hosted repository uses restricted one-shot RPCs and never replays initialization', async () => {
  const calls = [];
  const repository = createPhysicalRepository({ query: async (sql, args) => {
    calls.push([sql, args]);
    if (sql.includes('claim_physical_hosted_init')) return { rows: [{ result: true }] };
    if (sql.includes('get_physical_hosted_source')) return { rows: [{ result: { id } }] };
    if (sql.includes('persist_physical_hosted_session')) return { rows: [{ result: true }] };
    if (sql.includes('record_physical_hosted_document')) return { rows: [{ result: true }] };
    return { rows: [{ state: 'source_blocked' }] };
  } });
  assert.equal(await repository.claimHostedInit(id), true);
  assert.deepEqual(await repository.hostedSource(id), { id });
  await repository.persistHostedSession(id, { transactionId: 'hosted-1',
    confirmationKey: 'confirmation', redirectUrl: 'https://gateway21.pelecard.biz/PaymentGW?transactionId=hosted-1' });
  assert.equal(await repository.hostedDocumentState(id), 'source_blocked');
  await repository.recordHostedDocument(id, { state: 'succeeded', number: '595170',
    url: 'https://app.payper.co.il/public/invoice_show/595170', systemId: '595170' });
  assert.match(calls[0][0], /claim_physical_hosted_init/);
  assert.match(calls[2][0], /persist_physical_hosted_session/);
  assert.match(calls[4][0], /record_physical_hosted_document/);
});
