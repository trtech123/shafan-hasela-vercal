// Legacy POS tenders write receipt-only sales. Keep them disabled until each
// has an authoritative collection and accounting-document workflow.
const unverified = new Set(['אשראי', 'העברה', 'אפליקציה', 'חשבונית', 'מפוצל']);

export const isUnverifiedTender = method => unverified.has(method);
