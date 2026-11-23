// A sale location is a cashier decision, not a property inferred from the
// current product catalog. Keep this aligned with the production site CHECK.
export const ACCOUNTING_SITES = Object.freeze([
  'עכו', 'טבריה', 'נוף הגליל', 'שטח', 'פודטראק', 'קפה אקסטרים',
]);

export function requireAccountingSite(site) {
  if (!ACCOUNTING_SITES.includes(site)) throw new Error('accounting_site_required');
  return site;
}
