// A local preview of the immutable database cart calculation. The server must
// repeat these checks against its own catalog rows before reserving a payment.
const moneyMinor = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('catalog_price_required');
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) throw new Error('catalog_price_invalid');
  return rounded;
};

export function buildStandaloneCheckout(requested, catalog) {
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > 100 || !Array.isArray(catalog)) throw new Error('cart_invalid');
  const seen = new Set();
  let amountMinor = 0;
  const items = requested.map(line => {
    if (!line || Object.keys(line).sort().join(',') !== 'id,kind,qty' || !['product', 'service'].includes(line.kind) ||
      typeof line.id !== 'string' || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000) throw new Error('cart_line_invalid');
    const key = `${line.kind}:${line.id}`;
    if (seen.has(key)) throw new Error('cart_line_duplicate');
    seen.add(key);
    const source = catalog.find(row => row.id === line.id && row.kind === line.kind);
    if (!source || source.status !== 'פעיל' || typeof source.name !== 'string' || !source.name.trim()) throw new Error('catalog_item_unavailable');
    const unitMinor = moneyMinor(source.price);
    amountMinor += unitMinor * line.qty;
    if (!Number.isSafeInteger(amountMinor) || amountMinor > 2147483647) throw new Error('cart_amount_invalid');
    return { id: line.id, kind: line.kind, name: source.name.trim(), qty: line.qty, customPrice: unitMinor / 100, vatApplicable: true };
  });
  return { items, amountMinor, currency: 'ILS', vatApplicable: true };
}
