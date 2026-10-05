function normalizePhone(raw = '') {
  const digits = String(raw).replace(/\D/g, '');
  const normalized = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return normalized.length >= 9 && normalized.length <= 15 ? normalized : null;
}

export const ADDRESS_FIELDS = ['billing_address_line', 'billing_city', 'billing_postal_code', 'billing_country_code'];
const MASTER_FIELDS = ['customer_kind', 'display_name', 'contact_name', 'phone', 'email', 'organization_name', 'billing_name', 'billing_company_id', 'billing_accounting_email', ...ADDRESS_FIELDS];
export const canManageCustomers = (role) => ['admin', 'operations', 'cashier', 'אחמ"ש', 'קופאי'].includes(role);
export const canArchiveCustomers = (role) => ['admin', 'operations', 'אחמ"ש'].includes(role);

export function customerDraft(source = {}) {
  return customerPayload({
    ...source,
    customer_kind: source.customer_kind || 'person',
    display_name: source.display_name ?? source.client_name,
    contact_name: source.contact_name ?? source.client_name,
    phone: source.phone ?? source.client_phone,
    email: source.email ?? source.client_email,
    organization_name: source.organization_name ?? source.organization,
    billing_name: source.billing_name ?? source.billing_institution_name,
  });
}

export function customerPayload(source = {}) {
  return { ...Object.fromEntries(MASTER_FIELDS.map((key) => [key, String(source[key] ?? (key === 'customer_kind' ? 'person' : '')).trim()])), vat_applicable: typeof source.vat_applicable === 'boolean' ? source.vat_applicable : null };
}

export function customerToRecord(customer) {
  return {
    customer_id: customer.id,
    client_name: customer.contact_name || customer.display_name || '',
    client_phone: customer.phone || '',
    client_email: customer.email || '',
    organization: customer.organization_name || '',
    billing_institution_name: customer.billing_name || '',
    billing_company_id: customer.billing_company_id || '',
    billing_accounting_email: customer.billing_accounting_email || '',
    ...Object.fromEntries(ADDRESS_FIELDS.map((key) => [key, customer[key] || ''])),
  };
}

export function isPossibleDuplicate(left, right) {
  const phone = normalizePhone(left.phone || '');
  const companyId = value => String(value || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  const businessId = companyId(left.billing_company_id);
  const text = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return Boolean((phone && phone === normalizePhone(right.phone || '')) ||
    (businessId && businessId === companyId(right.billing_company_id)) ||
    ['email', 'display_name', 'organization_name'].some((key) => {
      const value = text(left[key]);
      return value && value === text(right[key]);
    }));
}

export function customerErrorMessage(error) {
  const code = `${error?.code || ''} ${error?.message || ''}`;
  if (/version|conflict|stale/i.test(code)) return 'כרטיס הלקוח עודכן בידי משתמש אחר. סגרו ופתחו שוב את הכרטיס לפני שמירה. השינויים שלכם עדיין מופיעים כאן.';
  if (/permission|forbidden|42501/i.test(code)) return 'אין הרשאה לבצע את הפעולה.';
  if (/archived/i.test(code)) return 'כרטיס הלקוח הועבר לארכיון ולא ניתן לשנות אותו.';
  if (/payment|paid|settled/i.test(code)) return 'לא ניתן לשנות חיוב כאשר נרשם תשלום או שתהליך תשלום עדיין פעיל.';
  return 'לא ניתן להשלים את הפעולה כרגע. נסו שוב.';
}
