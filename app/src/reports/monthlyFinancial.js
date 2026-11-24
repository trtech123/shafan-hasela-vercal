const agorot = value => Math.round(Number(value || 0) * 100);

export function summarizeMonthlyPayments(rows = []) {
  const total = { payments: 0, gross: 0, refunds: 0, refunded: 0, documents: 0, net: 0 };
  const byMethod = new Map();
  const byDay = new Map();
  const bySite = new Map();
  const byRegister = new Map();
  for (const row of rows) {
    const current = {
      payments: Number(row.completed_count || 0), gross: agorot(row.gross_amount),
      refunds: Number(row.refund_count || 0), refunded: agorot(row.refund_amount),
      documents: Number(row.issued_document_count || 0),
    };
    if (!Number.isSafeInteger(current.payments) || current.payments < 0 ||
      !Number.isSafeInteger(current.refunds) || current.refunds < 0 ||
      !Number.isSafeInteger(current.documents) || current.documents < 0 ||
      !Number.isSafeInteger(current.gross) || current.gross < 0 ||
      !Number.isSafeInteger(current.refunded) || current.refunded < 0) {
      throw new Error('monthly_report_invalid');
    }
    const empty = () => ({ payments: 0, gross: 0, refunds: 0, refunded: 0, documents: 0, net: 0 });
    if (!byMethod.has(row.payment_method)) byMethod.set(row.payment_method, empty());
    if (!byDay.has(row.day)) byDay.set(row.day, empty());
    if (!bySite.has(row.site)) bySite.set(row.site, empty());
    const register = row.register_number || 'ללא מסוף';
    if (!byRegister.has(register)) byRegister.set(register, empty());
    for (const target of [total, byMethod.get(row.payment_method), byDay.get(row.day),
      bySite.get(row.site), byRegister.get(register)]) {
      target.payments += current.payments;
      target.gross += current.gross;
      target.refunds += current.refunds;
      target.refunded += current.refunded;
      target.documents += current.documents;
      target.net = target.gross - target.refunded;
    }
  }
  return { total, byMethod: [...byMethod], bySite: [...bySite], byRegister: [...byRegister],
    byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)) };
}

// The accountant's example distinguishes card issuers and vouchers. The
// current verified payment ledger has neither issuer nor redeemed-voucher
// evidence, so those detail cells stay unavailable; the card subtotal is
// calculated from the actual completed Pelecard payments.
export function accountantMonthlyRows(summary) {
  const method = name => summary.byMethod.find(([label]) => label === name)?.[1]
    ?? { payments: 0, gross: 0, refunds: 0, refunded: 0, net: 0 };
  const asRow = (type, value, kind = 'method') => ({
    type, subtype: 'שקל', count: value.payments, original: value.gross / 100,
    ils: value.gross / 100,
    average: value.payments ? value.gross / 100 / value.payments : 0,
    kind,
  });
  const unavailable = type => ({ type, subtype: 'שקל', count: null,
    original: null, ils: null, average: null, kind: 'unavailable' });
  const credit = method('אשראי');
  const other = method('אחר');
  return [
    ...['American Express', 'Isracard', 'Leumi', 'Visa'].map(unavailable),
    asRow('אשראי — מנפיק לא זמין', credit),
    asRow('סה״כ אשראי', credit, 'subtotal'),
    asRow('המחאה', method('צ׳ק')),
    asRow('מזומן', method('מזומן')),
    unavailable('שובר'),
    ...(other.payments || other.refunds ? [asRow('אמצעי אחר', other)] : []),
    asRow('סה״כ', summary.total, 'total'),
  ];
}

export function monthlyReportCsv(rows, year, month) {
  const q = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const summary = summarizeMonthlyPayments(rows);
  const accountantRows = accountantMonthlyRows(summary);
  return '\uFEFF' + [
    ['חודש', `${year}-${String(month).padStart(2, '0')}`],
    ['סוג', 'תת סוג', 'כמות עסקאות', 'סכום במטבע מקור', 'סכום בשקלים', 'ממוצע לעסקה'],
    ...accountantRows.map(row => [row.type, row.subtype,
      row.count ?? 'לא זמין', row.original ?? 'לא זמין',
      row.ils ?? 'לא זמין', row.average ?? 'לא זמין']),
    ['החזרים', '', summary.total.refunds, summary.total.refunded / 100],
    ['נטו לאחר החזרים', '', '', '', summary.total.net / 100],
    [],
    ['תאריך', 'אתר', 'מסוף', 'אמצעי תשלום', 'תשלומים', 'ברוטו', 'החזרים', 'סכום החזרים', 'נטו', 'מסמכי Payper שהונפקו'],
    ...rows.map(row => [row.day, row.site, row.register_number || 'ללא מסוף',
      row.payment_method, row.completed_count, row.gross_amount,
      row.refund_count, row.refund_amount,
      (agorot(row.gross_amount) - agorot(row.refund_amount)) / 100,
      row.issued_document_count || 0]),
  ].map(line => line.map(q).join(',')).join('\r\n');
}
