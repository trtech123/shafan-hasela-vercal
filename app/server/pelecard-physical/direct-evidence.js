import { expectedParamX } from './reference.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function payperUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'app.payper.co.il' ||
      url.port || url.username || url.password || url.hash ||
      !/^\/public\/invoice_show\/[1-9][0-9]{0,29}$/.test(url.pathname) ||
      (url.search && !/^\?ak=[A-Za-z0-9_-]{16,128}$/.test(url.search))) return null;
    return url.href;
  } catch { return null; }
}

// Evidence is deliberately not a recorded payment or an associated ledger row.
export function projectUnlinkedDocumentEvidence(row) {
  const payment = row?.firstResponse?.payment;
  const document = row?.firstResponse?.document;
  const url = payperUrl(document?.url);
  if (!uuid.test(row?.paymentId ?? '') ||
    !['reserved', 'dispatching', 'pending', 'uncertain', 'approved'].includes(row.state) ||
    payment?.statusCode !== '000' || payment?.shvaResult !== '000' ||
    payment?.amountMinor !== row.amountMinor ||
    typeof payment?.paramX !== 'string' || payment.paramX.length < 16 ||
    !(row.uidRecoveryEnabled === true
      ? payment.paramX === expectedParamX({ id: row.paymentId, uidRecoveryEnabled: true })
      : row.paymentId.startsWith(payment.paramX)) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(payment?.transactionId ?? '') ||
    document?.state !== 'succeeded' ||
    !/^[1-9][0-9]{0,29}$/.test(document?.number ?? '') || !url)
    return null;
  return { paymentId: row.paymentId, paymentState: row.state,
    amountMinor: row.amountMinor, providerTransactionId: payment.transactionId,
    documentNumber: document.number, documentUrl: url, linked: false };
}
