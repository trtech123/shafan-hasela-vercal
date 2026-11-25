export const REVENUE_KINDS = {
  order: 'הזמנות פעילות',
  cancelled: 'הזמנות מבוטלות',
  receipt: 'תקבולים',
  refund: 'החזרים',
  void: 'ביטולי חיוב',
};

export function summarizeRevenueRows(rows) {
  const totals = { orderMinor: 0, cancelledMinor: 0, receiptMinor: 0,
    refundMinor: 0, voidMinor: 0, netMinor: 0 };
  for (const row of rows) {
    const amount = Number(row.amountMinor) || 0;
    if (row.kind === 'order') totals.orderMinor += amount;
    if (row.kind === 'cancelled') totals.cancelledMinor += amount;
    if (row.kind === 'receipt') totals.receiptMinor += amount;
    if (row.kind === 'refund') totals.refundMinor += amount;
    if (row.kind === 'void') totals.voidMinor += amount;
  }
  totals.netMinor = totals.receiptMinor - totals.refundMinor - totals.voidMinor;
  return totals;
}

export const formatRevenue = minor => (Number(minor) / 100).toLocaleString('he-IL', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function revenueCsv(rows) {
  const header = ['תאריך', 'אתר', 'סוג לקוח', 'סוג נתון', 'אמצעי', 'מספר אירועים', 'סכום ש״ח'];
  const lines = rows.map(row => [row.eventDate, row.site || 'ללא אתר',
    row.customerType || 'ללא סיווג', REVENUE_KINDS[row.kind] || row.kind,
    row.method || '', row.eventCount, (Number(row.amountMinor) / 100).toFixed(2)]);
  return '\uFEFF' + [header, ...lines].map(line => line.map(csvCell).join(',')).join('\r\n');
}
