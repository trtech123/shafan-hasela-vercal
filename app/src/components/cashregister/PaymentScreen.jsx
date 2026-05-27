import { ArrowRight, CreditCard, Banknote, Smartphone, Building2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";

const PAYMENT_METHODS = [
  { key: "מזומן",       label: "מזומן",         icon: Banknote,     color: "from-emerald-600 to-emerald-700", hint: "קבל מזומן וסמן ידנית" },
  { key: "אשראי",      label: "אשראי",          icon: CreditCard,   color: "from-blue-600 to-blue-700",     hint: "סלק דרך מסוף האשראי" },
  { key: "העברה",      label: "העברה בנקאית",  icon: Building2,    color: "from-purple-600 to-purple-700",  hint: "העברה / ביט / פייבוקס" },
  { key: "אפליקציה",   label: "ביט / Paybox",   icon: Smartphone,   color: "from-orange-600 to-orange-700", hint: "סלק דרך אפליקציה" },
  { key: "חשבונית",   label: "חשבונית / חח״ד", icon: Receipt,      color: "from-slate-600 to-slate-700",   hint: "חיוב מאוחר / ארגון" },
];

export default function PaymentScreen({ total, cartItems, onConfirm, onBack }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-lg space-y-8">

        <div className="text-center">
          <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm mb-6 mx-auto">
            <ArrowRight className="w-4 h-4" /> חזור לתפריט
          </button>
          <p className="text-slate-400 text-sm mb-1">סכום לתשלום</p>
          <p className="text-6xl font-bold text-emerald-300">{total.toLocaleString()}₪</p>
          <p className="text-slate-500 text-sm mt-2">{cartItems.length} פריטים</p>
        </div>

        <div className="space-y-2">
          <p className="text-slate-400 text-sm font-medium text-center mb-4">בחר אמצעי תשלום</p>
          {PAYMENT_METHODS.map(method => {
            const Icon = method.icon;
            return (
              <button
                key={method.key}
                onClick={() => onConfirm(method.key)}
                className={`w-full bg-gradient-to-l ${method.color} rounded-2xl p-5 flex items-center gap-4 hover:opacity-90 active:scale-[0.98] transition-all text-right`}
              >
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-lg">{method.label}</p>
                  <p className="text-white/60 text-sm">{method.hint}</p>
                </div>
                <div className="mr-auto text-white/40 text-2xl">←</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}