const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(['unpaid', 'partial', 'paid', 'review', 'unavailable']);

export const financialPresentation = Object.freeze({
  unpaid: { label: 'לא שולם', canCollect: true },
  partial: { label: 'שולם חלקית', canCollect: true },
  paid: { label: 'התשלום בוצע', canCollect: false },
  review: { label: 'תשלום בבדיקה', canCollect: false },
  unavailable: { label: 'גבייה לא זמינה', canCollect: false },
});

export function orderFinancialPresentation(summary) {
  return financialPresentation[summary?.state] ?? financialPresentation.review;
}

export async function loadOrderFinancialBadges(client, ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  if (unique.length > 1000 || unique.some(id => !uuid.test(id)))
    throw new Error('order_financial_badges_invalid');
  const result = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const requested = unique.slice(offset, offset + 100);
    const { data, error } = await client.rpc('get_order_financial_badges', { p_order_ids: requested });
    if (error || !Array.isArray(data)) throw new Error('order_financial_badges_unavailable');
    for (const row of data) {
      if (!requested.includes(row?.orderId) || !states.has(row?.state) ||
        !Number.isSafeInteger(row?.totalMinor) || !Number.isSafeInteger(row?.paidMinor) ||
        !Number.isSafeInteger(row?.balanceMinor) || result[row.orderId])
        throw new Error('order_financial_badges_invalid');
      result[row.orderId] = row;
    }
  }
  return result;
}
