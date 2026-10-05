// List and export share exactly the same filters. Voucher values are immutable
// historical snapshots; never enrich a report from the mutable customer master.
export const REPORT_COLUMNS = 'voucher_number,created_at,register_code,register_name,billing_name,billing_company_id,contact_name,phone,service_description,notes,creator_name,order_number,vat_applicable';
export const REPORT_LIMIT = 500;
export function applyVoucherFilters(query, { search = '', register = '', dateFrom = '', dateTo = '', creator = '' } = {}) {
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) throw new Error('invalid_date_range');
  const term = search.replace(/[^\p{L}\p{N}\s@+-]/gu, '').trim().slice(0, 100);
  if (term) query = query.or(['voucher_number','order_number','billing_name','billing_company_id','contact_name','phone','service_description','notes'].map(field => `${field}.ilike.%${term}%`).join(','));
  if (register) query = query.eq('register_code', register);
  if (dateFrom) query = query.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString());
  if (dateTo) { const end = new Date(`${dateTo}T00:00:00`); end.setDate(end.getDate() + 1); query = query.lt('created_at', end.toISOString()); }
  const name = creator.replace(/[%_*\\]/g, '').trim().slice(0, 100);
  if (name) query = query.ilike('creator_name', `%${name}%`);
  return query;
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00`).getTime()); }

export async function fetchVoucherReport(client, filters, { cutoff = new Date().toISOString(), signal } = {}) {
  const rows = [];
  let total;
  for (let offset = 0; offset <= REPORT_LIMIT; offset += 200) {
    let query = applyVoucherFilters(client.from('hakafa_vouchers').select(REPORT_COLUMNS, { count: 'exact' })
      .lte('created_at', cutoff).order('created_at', { ascending: false }).order('id'), filters);
    if (signal) query = query.abortSignal(signal);
    const result = await query.range(offset, offset + 199);
    if (result.error || signal?.aborted) throw new Error('report_fetch_failed');
    if (!Number.isInteger(result.count) || !Array.isArray(result.data)) throw new Error('report_incomplete');
    if (result.count > REPORT_LIMIT) throw new Error('report_too_large');
    if (total !== undefined && total !== result.count) throw new Error('report_incomplete');
    total = result.count;
    rows.push(...result.data);
    if (rows.length === total) return rows;
    if (result.data.length < 200 || rows.length > total) throw new Error('report_incomplete');
  }
  throw new Error('report_too_large');
}

export function voucherReportError(error) {
  if (error?.message === 'invalid_date_range') return 'יש לבחור טווח תאריכים תקין: תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה.';
  if (error?.message === 'report_too_large' || error?.message === 'pdf_too_many_pages') return 'הדו״ח גדול מדי. יש לצמצם את טווח התאריכים או את הסינון ולהוריד שוב (עד 500 שוברים בכל דו״ח).';
  return 'לא ניתן להשלים את הדו״ח. לא הורד דו״ח חלקי ולא שונה אף שובר. ניתן לנסות שוב או לצמצם את הסינון.';
}
