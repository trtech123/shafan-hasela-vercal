import { strToU8, zipSync } from 'fflate';
import { accountantMonthlyRows, summarizeMonthlyPayments } from './monthlyFinancial';

const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);

function column(index) {
  let value = index + 1; let result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26); }
  return result;
}

function sheet(rows) {
  const body = rows.map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.map((value, colIndex) => {
    if (value === null || value === undefined || value === '') return '';
    const ref = `${column(colIndex)}${rowIndex + 1}`;
    return typeof value === 'number' && Number.isFinite(value)
      ? `<c r="${ref}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>` +
    `<sheetData>${body}</sheetData></worksheet>`;
}

/** Accountant example layout plus an auditable daily/source breakdown. Empty
 * issuer and voucher cells are intentionally marked unavailable. */
export function monthlyReportXlsx(rows, year, month, payers = null) {
  const summary = summarizeMonthlyPayments(rows);
  const layout = [
    ['דוח קופה חודשי — תפעולי', `${year}-${String(month).padStart(2, '0')}`],
    ['סוג', 'תת סוג', 'כמות עסקאות', 'סכום במטבע מקור', 'סכום בשקלים', 'ממוצע לעסקה'],
    ...accountantMonthlyRows(summary).map(row => [row.type, row.subtype,
      row.count ?? 'לא זמין', row.original ?? 'לא זמין',
      row.ils ?? 'לא זמין', row.average ?? 'לא זמין']),
    ['מספר החזרים', '', summary.total.refunds],
    ['סכום החזרים בשקלים', '', '', '', summary.total.refunded / 100],
    ['נטו לאחר החזרים', '', '', '', summary.total.net / 100],
    ['לקוחות משלמים מזוהים', '', payers?.identified_customers ?? 'לא זמין'],
    ['תשלומים ללא זיהוי לקוח', '', payers?.unidentified_payments ?? 'לא זמין'],
    ['תעודות זיכוי רשמיות', '', 'לא זמין'],
    ['הערה', 'מנפיקי כרטיס, מימושי שוברים ותעודות זיכוי אינם מזוהים במקור המאומת'],
    ['הערה', 'רק תשלומים שהושלמו בשקלים נכללים; אין מדובר בדוח Z מאושר'],
  ];
  const detail = [
    ['תאריך', 'אתר', 'מסוף', 'אמצעי תשלום', 'מספר עסקאות', 'ברוטו בשקלים',
      'מספר החזרים', 'סכום החזרים', 'נטו', 'מסמכי Payper'],
    ...rows.map(row => [row.day, row.site, row.register_number || 'ללא מסוף',
      row.payment_method, Number(row.completed_count), Number(row.gross_amount),
      Number(row.refund_count), Number(row.refund_amount),
      Math.round((Number(row.gross_amount) - Number(row.refund_amount)) * 100) / 100,
      Number(row.issued_document_count || 0)]),
  ];
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="סיכום" sheetId="1" r:id="rId1"/>` +
      `<sheet name="פירוט יומי" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet(layout),
    'xl/worksheets/sheet2.xml': sheet(detail),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
}
