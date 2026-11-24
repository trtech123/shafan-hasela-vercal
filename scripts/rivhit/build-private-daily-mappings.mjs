import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapJournalSource } from '../../supabase/functions/_shared/rivhit-journal/mapper.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDir = join(root, '.local', 'accounting');
const seedPath = join(privateDir, 'anat-reference-20261124.sql');
const rows = [...(await readFile(seedPath, 'utf8')).matchAll(
  /\((\d+),'([^']+)',(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/g,
)];
const expectedCodes = [102, 103, 107, 116, 117, 118];
if (rows.length !== expectedCodes.length) throw new Error('accountant_reference_incomplete');
const groups = new Map(rows.map(match => {
  const [, code, name, revenue, cash, cheque, card, vat, sourceRow] = match;
  const values = [code, revenue, cash, cheque, card, vat, sourceRow].map(Number);
  if (!values.every(Number.isSafeInteger) || values.slice(0, 5).some(value => value < 1)
    || values[5] < 0 || values[5] > 10000 || values[6] < 1 || !name.trim())
    throw new Error('accountant_reference_invalid');
  return [Number(code), { revenue: Number(revenue), cash: Number(cash),
    cheque: Number(cheque), card: Number(card), vat: Number(vat) }];
}));
if (groups.size !== 6 || expectedCodes.some(code => !groups.has(code)))
  throw new Error('accountant_reference_codes_invalid');

const pending = new Map([['פודטראק', 107], ['שטח', 116]]);
const accepted = new Map([['עכו', 102], ['טבריה', 103],
  ['נוף הגליל', 118], ['קפה אקסטרים', 117]]);
for (const arg of process.argv.slice(2)) {
  const match = /^--approve-site=(.+)$/.exec(arg);
  if (!match || !pending.has(match[1]) || accepted.has(match[1]))
    throw new Error('site_approval_argument_invalid');
  accepted.set(match[1], pending.get(match[1]));
}
const sql = ['-- PRIVATE APPROVAL PACKAGE. Apply only after the site decisions and release approval.',
  'BEGIN;'];
for (const [site, code] of accepted) {
  if (pending.has(site)) sql.push(`UPDATE public.rivhit_accounting_site_groups SET approved=true
    WHERE site='${site}' AND accountant_sort_code=${code} AND approved=false;`);
}
const mappings = [];
const syntheticSource = {
  id: '00000000-0000-4000-8000-000000000001',
  payper_document_number: 'SYNTHETIC', captured_at: '2026-11-25T12:00:00Z',
};
for (const [site, code] of accepted) {
  const account = groups.get(code);
  for (const [provider, debitAccount] of [
    ['pelecard', account.card], ['manual_cash', account.cash],
    ['manual_check', account.cheque],
  ]) {
    const mapping = { version: 'anat-20261124', provider, site, sortCode: code,
      debitAccount, creditAccount: account.revenue,
      vatRateBasisPoints: account.vat, accountingDate: 'capture_israel_date' };
    const mapped = await mapJournalSource({ ...syntheticSource,
      source_facts: { provider, site, amount: 118, currency: 'ILS',
        receiptNumber: 'SYNTHETIC', vatApplicable: account.vat > 0 },
    }, mapping);
    sql.push(`INSERT INTO public.rivhit_journal_approved_mappings
      (provider,site,mapping_version,sort_code,debit_account,credit_account,
        vat_rate_basis_points,accountant_sort_code,enabled)
      VALUES ('${provider}','${site}','${mapped.mappingVersion}',${code},
        ${debitAccount},${account.revenue},${account.vat},${code},true);`);
    mappings.push(mapping);
  }
}
sql.push('COMMIT;');
await writeFile(join(privateDir, 'daily-mappings-activation.sql'),
  `${sql.join('\n')}\n`, { flag: 'w', mode: 0o600 });
await writeFile(join(privateDir, 'daily-mappings-worker.json'),
  `${JSON.stringify(mappings)}\n`, { flag: 'w', mode: 0o600 });
console.log(JSON.stringify({ approvedSites: accepted.size,
  pendingSites: [...pending.keys()].filter(site => !accepted.has(site)).length,
  mappingRows: mappings.length, privateOutput: true }));
