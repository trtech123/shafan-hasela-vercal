import { orderFinancialPresentation } from '@/payments/orderFinancialBadges';

export default function OrderCollectionAction({ financial, allowed, orderId, className = '' }) {
  const { label, canCollect } = orderFinancialPresentation(financial);
  if (canCollect && allowed) return <a
    href={`/cashregister?orderId=${encodeURIComponent(orderId)}`}
    className={`rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 ${className}`}>
    גבייה בקופה
  </a>;
  const tone = financial?.state === 'paid'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-amber-200 bg-amber-50 text-amber-900';
  return <span role="status" className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${tone} ${className}`}>
    {label}
  </span>;
}
