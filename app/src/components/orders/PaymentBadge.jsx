import { cn } from "@/lib/utils";
import { orderFinancialPresentation } from '@/payments/orderFinancialBadges';

const paymentStyles = {
  "לא שולם": "bg-red-50 text-red-600 border-red-200",
  "מקדמה": "bg-amber-50 text-amber-700 border-amber-200",
  "שולם במלואו": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default function PaymentBadge({ status = undefined, financial }) {
  const verified = status === undefined || financial !== undefined
    ? orderFinancialPresentation(financial) : null;
  const tone = financial?.state === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : financial?.state === 'partial' ? 'bg-amber-50 text-amber-700 border-amber-200'
      : financial?.state === 'review' ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-muted text-muted-foreground border-border';
  return (
    <span className={cn(
      "inline-flex px-2.5 py-1 rounded-full text-xs font-medium border",
      verified ? tone : paymentStyles[status] || "bg-muted text-muted-foreground border-border"
    )}>
      {verified ? verified.label : status || "—"}
    </span>
  );
}
