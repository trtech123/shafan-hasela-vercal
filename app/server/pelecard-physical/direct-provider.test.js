import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalPelecardProvider } from './provider.js';

const source = { id: 'intent-1', register: '004', amountMinor: 1500,
  checkoutSnapshot: { items: [{ name: 'Synthetic order', qty: 1, customPrice: 15 }], discount: null },
  billingSnapshot: { kind: 'person', name: 'Synthetic Customer', identity: '123456782',
    email: 'synthetic@example.test', vatApplicable: true } };

test('J4 includes Payper only when the separate direct invoice gate is enabled', async () => {
  const bodies = [];
  const fetcher = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ StatusCode: '000', DebitTotal: '1500',
      PayperData: { InvoiceStatus: 'Success', InvoiceNumber: '595170',
        InvoiceLink: 'https://app.payper.co.il/public/invoice_show/595170?ak=abcdefghijklmnop' } }));
  };
  const provider = createPhysicalPelecardProvider({ terminalNumber: '2814926015',
    user: 'synthetic', password: 'synthetic', fetcher });
  const args = { merchantTerminal: '2814926015', register: '004', amountMinor: 1500, intentId: 'intent-1' };
  const off = await provider.send(args);
  assert.equal(bodies[0].PayperParameters, undefined);
  assert.equal(off.firstResponse.document.state, 'succeeded');
  await provider.send({ ...args, payperSource: source });
  assert.equal(bodies[1].PayperParameters.typeDocument, 'Invoice-Receipt');
  assert.equal(bodies[1].PayperParameters.DataPayper.invoice_lines[0].price_per_unit, '1500');
});
