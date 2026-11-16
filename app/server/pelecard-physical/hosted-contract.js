// IFrame20 Hebrew 08.24 pp. 5-6, 17, 26-27; Services REST 09.26 pp. 13, 16, 32-33.
// The hosted page presents a PINPAD button. Initialization never charges a card.
import { validIsraeliIdentity } from '../../src/payments/payperBilling.js';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 &&
  value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const money = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('physical_amount_invalid');
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0 || Math.abs(minor - value * 100) > 1e-7)
    throw new Error('physical_amount_invalid');
  return minor;
};
const safeUrl = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('physical_callback_url_invalid');
  return url.href;
};

export function buildPhysicalPayperParameters(intent) {
  if (!record(intent) || intent.register !== '004' ||
    !Number.isSafeInteger(intent.amountMinor) || intent.amountMinor < 1 ||
    !text(intent.id, 100) || !/^[A-Za-z0-9_-]+$/.test(intent.id))
    throw new Error('physical_intent_invalid');
  const billing = intent.billingSnapshot;
  const snapshot = intent.checkoutSnapshot;
  if (!record(billing) || !['person', 'organization'].includes(billing.kind) ||
    !text(billing.name, 200) || !/^[0-9]{9}$/.test(billing.identity) ||
    billing.identity === '000000000' || !text(billing.email, 320) ||
    (billing.kind === 'person' && !validIsraeliIdentity(billing.identity)) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email) ||
    typeof billing.vatApplicable !== 'boolean' || !record(snapshot) ||
    !Array.isArray(snapshot.items) || snapshot.items.length < 1 || snapshot.items.length > 100)
    throw new Error('physical_billing_or_vat_invalid');
  let sum = 0;
  const invoiceLines = snapshot.items.map(item => {
    if (!record(item) || !text(item.name, 200) ||
      !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 1000)
      throw new Error('physical_item_invalid');
    const unit = money(item.customPrice);
    sum += unit * item.qty;
    if (!Number.isSafeInteger(sum)) throw new Error('physical_amount_invalid');
    return { description: item.name, quantity: String(item.qty),
      price_per_unit: String(unit), include_vat: billing.vatApplicable ? 'true' : 'false',
      no_vat: billing.vatApplicable ? 'false' : 'true', currency_symbol: 'ILS' };
  });
  if (snapshot.discount != null) {
    const discount = snapshot.discount;
    if (!record(discount) || money(discount.original_total) !== sum ||
      money(discount.final_total) !== intent.amountMinor || sum <= intent.amountMinor)
      throw new Error('physical_discount_invalid');
    // Payper has no documented discount line contract in this response. Use the
    // authorized gross after discount and preserve the actual item names.
    invoiceLines.splice(0, invoiceLines.length, {
      description: snapshot.items.map(item => item.name).join(', ').slice(0, 200),
      quantity: '1', price_per_unit: String(intent.amountMinor),
      include_vat: billing.vatApplicable ? 'true' : 'false',
      no_vat: billing.vatApplicable ? 'false' : 'true', currency_symbol: 'ILS' });
  } else if (sum !== intent.amountMinor) throw new Error('physical_amount_mismatch');
  return { typeDocument: 'Invoice-Receipt', DataPayper: {
    customer_unique_id: billing.identity, customer_mail: billing.email,
    customer_name: billing.name, send_by_mail: 'true', document_rounded: 'false',
    document_no_vat: billing.vatApplicable ? 'false' : 'true',
    invoice_lines: invoiceLines, receipt_lines: [],
  } };
}

export function buildHostedEmvRequest(intent, credentials, urls) {
  const payperParameters = buildPhysicalPayperParameters(intent);
  if (!record(credentials) || !/^\d{10}$/.test(credentials.terminal) ||
    !text(credentials.user, 100) || !text(credentials.password, 200) || !record(urls))
    throw new Error('physical_credentials_required');
  return { terminal: credentials.terminal, user: credentials.user, password: credentials.password,
    ActionType: 'J4', Currency: '1', FreeTotal: 'False', ShopNo: '004',
    Total: String(intent.amountMinor), EmvPinpad: 'True', CreateToken: 'False',
    UserKey: intent.id, GoodURL: safeUrl(urls.goodUrl), ErrorURL: safeUrl(urls.errorUrl),
    CancelURL: safeUrl(urls.errorUrl), ServerSideGoodFeedbackURL: safeUrl(urls.callbackUrl),
    ServerSideErrorFeedbackURL: safeUrl(urls.callbackUrl), resultDataKeyName: 'result',
    PayperParameters: payperParameters };
}

export function parseHostedPayperData(value) {
  const blocked = { state: 'reconciliation_required' };
  if (!record(value) || value.InvoiceStatus !== '000' ||
    !/^[1-9][0-9]{0,29}$/.test(String(value.InvoiceNumber ?? '')) ||
    value.InvoiceError) return blocked;
  const number = String(value.InvoiceNumber);
  if (!text(value.InvoiceLink, 2048)) return blocked;
  let url;
  try { url = new URL(value.InvoiceLink); } catch { return blocked; }
  if (url.protocol !== 'https:' || url.hostname !== 'app.payper.co.il' ||
    url.port || url.username || url.password || url.hash ||
    url.pathname !== `/public/invoice_show/${number}` ||
    (url.search && !/^\?ak=[A-Za-z0-9_-]{16,128}$/.test(url.search))) return blocked;
  let systemId = null;
  if (/^[1-9][0-9]{0,29}$/.test(String(value.document_system_id ?? '')))
    systemId = String(value.document_system_id);
  try {
    const raw = typeof value.RawResponse === 'string' && value.RawResponse.length <= 65_536
      ? JSON.parse(value.RawResponse) : null;
    if (record(raw) && /^[1-9][0-9]{0,29}$/.test(String(raw.document_system_id ?? '')))
      systemId = String(raw.document_system_id);
  } catch { /* An opaque raw response is never stored or logged. */ }
  return { state: 'succeeded', number, url: url.href, systemId };
}

export function classifyHostedEmvResult(value, expected) {
  const document = parseHostedPayperData(record(value) ? value.PayperData : null);
  const data = record(value) && record(value.ResultData) ? value.ResultData : null;
  const detail = record(expected?.deviceDetails) ? expected.deviceDetails : null;
  if (value?.StatusCode !== '000' || !data ||
    expected?.register !== '004' || !/^\d{10}$/.test(expected?.merchantTerminal ?? '') ||
    data.TransactionId !== expected.transactionId ||
    !text(expected?.confirmationKey, 512) || data.ConfirmationKey !== expected.confirmationKey ||
    String(data.DebitTotal ?? '') !== String(expected.amountMinor) ||
    data.DebitCurrency !== '1' || data.ShvaResult !== '000' ||
    data.ShvaResultEmv !== '000' ||
    !text(String(data.TransactionPelecardId ?? ''), 100) ||
    !text(String(data.Uid ?? ''), 100) ||
    !text(String(data.DebitApproveNumber ?? ''), 100) || !detail ||
    detail.StatusCode !== '000' || String(detail.Uid ?? detail.UID ?? '') !== String(data.Uid) ||
    String(detail.termNo ?? '') !== expected.register ||
    String(detail.Amount ?? '') !== String(expected.amountMinor) ||
    String(detail.retailer ?? '') !== expected.merchantTerminal)
    return { paymentState: 'uncertain', document: { state: 'unverified' } };
  return { paymentState: 'approved', providerTransactionId: String(data.TransactionPelecardId),
    uid: String(data.Uid), approvalId: String(data.DebitApproveNumber), document };
}
