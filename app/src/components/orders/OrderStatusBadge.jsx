import { cn } from "@/lib/utils";

const statusStyles = {
  "ממתין לאישור": "bg-amber-50 text-amber-700 border-amber-200",
  "מאושר": "bg-blue-50 text-blue-700 border-blue-200",
  "שולם": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "בוצע": "bg-slate-100 text-slate-600 border-slate-200",
  "בוטל": "bg-red-50 text-red-600 border-red-200",
};

export default function OrderStatusBadge({ status }) {
  return (
    <span className={cn(
      "inline-flex px-2.5 py-1 rounded-full text-xs font-medium border",
      statusStyles[status] || "bg-muted text-muted-foreground border-border"
    )}>
      {status || "—"}
    </span>
  );
}