const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = /^[0-9]{1,8}(?:\.[0-9]{1,2})?$/;

function cents(value) {
  const text = String(value);
  if (!money.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

/** Reprices product/service IDs on the server. No client price or amount enters the intent. */
export function createPhysicalCartCalculator(database, actorRole = 'cashier') {
  return async cart => {
    const lines = cart?.lines;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100)
      throw new Error('physical_cart_invalid');
    const seen = new Set();
    const items = [];
    let amountMinor = 0;
    for (const line of lines) {
      if (!line || Object.keys(line).sort().join(',') !== 'id,kind,qty' ||
        !uuid.test(line.id) || !['product', 'service'].includes(line.kind) ||
        !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 1000 || seen.has(line.id))
        throw new Error('physical_cart_invalid');
      seen.add(line.id);
      const product = line.kind === 'product';
      const { rows } = await database.query(product
        ? 'SELECT name,price,status FROM public.products WHERE id=$1'
        : 'SELECT name,price_per_person AS price,status FROM public.activities WHERE id=$1', [line.id]);
      const row = rows?.length === 1 ? rows[0] : null;
      const unitMinor = row ? cents(row.price) : null;
      if (row?.status !== 'פעיל' || typeof row.name !== 'string' ||
        !row.name.trim() || row.name.trim().length > 200 || unitMinor === null)
        throw new Error('physical_catalog_unavailable');
      amountMinor += unitMinor * line.qty;
      if (!Number.isSafeInteger(amountMinor) || amountMinor > 2_147_483_647)
        throw new Error('physical_cart_amount_invalid');
      items.push({ id: line.id, name: row.name.trim(), qty: line.qty, customPrice: unitMinor / 100 });
    }
    if (cart.discount != null) {
      if (actorRole !== 'admin') throw new Error('physical_discount_forbidden');
      const discount = cart.discount;
      const valueMinor = cents(discount?.value);
      if (!discount || Object.keys(discount).sort().join(',') !== 'mode,type,value' ||
        !['הנחת עובד', 'הנחת נכה', 'הנחה כללית'].includes(discount.type) ||
        !['fixed', 'percentage'].includes(discount.mode) || valueMinor === null ||
        (discount.mode === 'percentage' && valueMinor > 10_000))
        throw new Error('physical_discount_invalid');
      const deduction = discount.mode === 'fixed' ? valueMinor
        : Math.round(amountMinor * valueMinor / 10_000);
      if (deduction < 1 || deduction >= amountMinor) throw new Error('physical_discount_invalid');
      const original = amountMinor;
      amountMinor -= deduction;
      return { amountMinor, items, discount: {
        ...discount, original_total: original / 100, final_total: amountMinor / 100,
      } };
    }
    return { amountMinor, items };
  };
}
