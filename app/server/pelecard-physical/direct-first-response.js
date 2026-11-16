const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = (value, max = 100) =>
  (typeof value === 'string' || typeof value === 'number') &&
  String(value).length > 0 && String(value).length <= max ? String(value) : null;
const identifier = value => {
  const text = scalar(value);
  return text && /^[A-Za-z0-9_-]+$/.test(text) ? text : null;
};
const invoiceNumber = value => {
  const text = scalar(value, 30);
  return text && /^[1-9][0-9]*$/.test(text) ? text : null;
};

export function projectDirectFirstResponse(raw) {
  if (!plain(raw)) throw new Error('physical_first_response_invalid');
  const source = plain(raw.ResultData) ? raw.ResultData : raw;
  const payper = plain(raw.PayperData) ? raw.PayperData : raw;
  let systemId = invoiceNumber(payper.document_system_id);
  let documentId = identifier(payper.document_id);
  if (typeof payper.RawResponse === 'string' && payper.RawResponse.length <= 65_536) {
    try {
      const detail = JSON.parse(payper.RawResponse);
      if (plain(detail)) {
        systemId = invoiceNumber(detail.document_system_id) ?? systemId;
        documentId = identifier(detail.document_id) ?? documentId;
      }
    } catch { /* The opaque provider body is never retained. */ }
  }
  const status = identifier(payper.InvoiceStatus);
  const number = invoiceNumber(payper.InvoiceNumber);
  const link = scalar(payper.InvoiceLink, 2048);
  let url = null;
  try {
    if (link) {
      const parsed = new URL(link);
      if (parsed.protocol === 'https:' && parsed.hostname === 'app.payper.co.il' &&
        !parsed.port && !parsed.username && !parsed.password && !parsed.hash &&
        parsed.pathname === `/public/invoice_show/${number}` &&
        (!parsed.search || /^\?ak=[A-Za-z0-9_-]{16,128}$/.test(parsed.search))) url = parsed.href;
    }
  } catch { /* Invalid links require reconciliation. */ }
  const issued = ['000', 'OK', 'Success'].includes(status) && number && url && !payper.InvoiceError;
  return {
    payment: {
      statusCode: identifier(raw.StatusCode), shvaResult: identifier(source.ShvaResult),
      shvaResultEmv: identifier(source.ShvaResultEmv),
      transactionId: identifier(source.PelecardTransactionId ?? source.TransactionPelecardId),
      uid: identifier(source.UID ?? source.Uid),
      approvalId: identifier(source.DebitApproveNumber),
      amountMinor: /^\d+$/.test(String(source.DebitTotal ?? '')) ? Number(source.DebitTotal) : null,
      currency: identifier(source.DebitCurrency ?? source.currency),
      paramX: identifier(source.AdditionalDetailsParamX ?? source.paramX),
      terminal: identifier(source.TerminalNumber), register: identifier(source.termNo),
    },
    document: { state: issued ? 'succeeded' : 'reconciliation_required', status,
      number: issued ? number : null, url: issued ? url : null,
      systemId: issued ? systemId : null, documentId: issued ? documentId : null },
  };
}
