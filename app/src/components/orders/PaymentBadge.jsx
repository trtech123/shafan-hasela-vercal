import { cn } from "@/lib/utils";

const paymentStyles = {
  "לא שולם": "bg-red-50 text-red-600 border-red-200",
  "מקדמה": "bg-amber-50 text-amber-700 border-amber-200",
  "שולם במלואו": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default function PaymentBadge({ status }) {
  return (
    <span className={cn(
      "inline-flex px-2.5 py-1 rounded-full text-xs font-medium border",
      paymentStyles[status] || "bg-muted text-muted-foreground border-border"
    )}>
      {status || "—"}
    </span>
  );
}