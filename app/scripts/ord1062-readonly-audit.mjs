import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';

const root = process.env.SHAFAN_CONFIG_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
function env(file, key) {
  const line = readFileSync(join(root, file), 'utf8').split(/\r?\n/)
    .find(value => value.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
}
const url = env('.env', 'VITE_SUPABASE_URL');
const key = env('.env.local', 'SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('read_only_credentials_unavailable');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const orderId = '91d530c4-f819-4ce8-9c4b-e30010b9a866';
const paymentId = '833db2d6-18b1-4d66-bbcd-4360b95a315c';
async function read(table, columns, field, value) {
  const { data, error } = await db.from(table).select(columns).eq(field, value);
  if (error) return { denied: { table, code: error.code, message: error.message } };
  return data;
}
async function rpc(name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) return { denied: { rpc: name, code: error.code, message: error.message } };
  return data;
}

const [orders, payments, intent, sales, ledger, registerIntents, device,
  accountingDocuments, accountingEvents, providerPayments, invoiceLedger,
  paymentSales, paymentLedger, invoiceSystemLedger] = await Promise.all([
  read('orders', 'id,order_number,status,payment_status,total_price', 'id', orderId),
  read('payment_transactions', 'id,order_id,amount,currency,status,provider_transaction_id,sale_id,operation,created_at', 'order_id', orderId),
  rpc('get_physical_worker_intent', { p_payment_id: paymentId }),
  read('sales', 'id,order_id,payment_transaction_id,total,receipt_number', 'order_id', orderId),
  read('payper_document_ledger', 'payment_id,order_id,sale_id,state,document_number,physical_document_system_id,reconciliation_code', 'order_id', orderId),
  rpc('list_physical_worker_intents', {}),
  read('physical_terminal_devices', 'register_number,model,enabled,cash_register_code', 'register_number', '004'),
  read('accounting_documents', 'source_id,status,external_document_id', 'source_id', paymentId),
  read('accounting_events', 'source_id,status,purpose', 'source_id', paymentId),
  read('payment_transactions', 'id,order_id,amount,status,provider_transaction_id,sale_id',
    'provider_transaction_id', '3199515577'),
  read('payper_document_ledger', 'payment_id,order_id,sale_id,state,document_number,physical_document_system_id',
    'document_number', '200006'),
  read('sales', 'id,order_id,payment_transaction_id,total', 'payment_transaction_id', paymentId),
  read('payper_document_ledger', 'payment_id,order_id,sale_id,state,document_number', 'payment_id', paymentId),
  read('payper_document_ledger', 'payment_id,order_id,sale_id,state,document_number',
    'physical_document_system_id', '3650292'),
]);
const unresolved = new Set(['reserved', 'dispatching', 'pending', 'uncertain', 'approved']);
const first = intent?.firstResponse;
const result = {
  observedAt: new Date().toISOString(), databaseHost: new URL(url).host,
  order: Array.isArray(orders) ? orders[0] ?? null : orders,
  payments,
  intent: intent?.denied ? intent : { ...intent, firstResponse: {
    payment: first?.payment && Object.fromEntries([
      'StatusCode', 'ShvaResult', 'ShvaResultEmv', 'Amount', 'DebitCurrency',
      'termNo', 'retailer', 'PelecardTransactionId', 'DebitApproveNumber',
      'UID', 'AdditionalDetailsParamX',
    ].map(field => [field, first.payment[field]])),
    document: first?.document && {
      status: first.document.status, documentNumber: first.document.documentNumber,
      systemId: first.document.systemId, urlPresent: Boolean(first.document.url),
    },
  } },
  sales, ledger,
  register004: { device, unresolvedIntents: Array.isArray(registerIntents)
    ? registerIntents.filter(row => unresolved.has(row.state)) : registerIntents },
  accountingDocuments, accountingEvents,
  duplicateChecks: { providerPayments, invoiceLedger, paymentSales, paymentLedger,
    invoiceSystemLedger },
};
if (process.argv.includes('--payper')) {
  const documentUrl = first?.document?.url;
  const parsed = new URL(documentUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'app.payper.co.il' ||
    parsed.pathname !== '/public/invoice_show/3650292' ||
    !/^\?ak=[A-Za-z0-9_-]{16,128}$/.test(parsed.search))
    throw new Error('payper_link_invalid');
  try {
    const response = await fetch(parsed, { method: 'GET', redirect: 'manual',
      signal: AbortSignal.timeout(15000) });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('text/html') ? (await response.text()).slice(0, 1_000_000) : '';
    const page = new JSDOM(body);
    page.window.document.querySelectorAll('script,style').forEach(element => element.remove());
    const visibleText = page.window.document.body?.textContent?.replace(/\s+/g, ' ') ?? '';
    const amountRows = [...page.window.document.querySelectorAll('tr')]
      .filter(element => /(?:^|\D)1[.,]00(?:\D|$)/.test(element.textContent ?? ''));
    result.payperHostedRead = { status: response.status, contentType,
      numberPresent: body.includes('200006'), amountPresent: body.includes('1.00') || body.includes('1,00'),
      amountWithCurrencyPresent: /(?:₪|&#8362;|ש[״"]?ח)\s*1[.,]00|1[.,]00\s*(?:₪|&#8362;|ש[״"]?ח)/.test(body),
      numberVisible: visibleText.includes('200006'),
      amountVisible: /(?:^|\D)1[.,]00(?:\D|$)/.test(visibleText),
      amountRows: amountRows.length,
      invoiceReceiptMarker: /חשבונית\s*(?:מס\s*)?[/-]?\s*קבלה|Invoice[ -]?Receipt/i.test(body),
      transactionIdPresent: body.includes('3199515577'), uidPresent: body.includes('26111814405328149265672'),
      numberOccurrences: body.split('200006').length - 1,
      bytesRead: body.length };
  } catch (error) {
    result.payperHostedRead = { error: error?.name ?? 'unavailable' };
  }
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
