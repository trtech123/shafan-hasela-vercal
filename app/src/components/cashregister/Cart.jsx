import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISCOUNT_TYPES = ["הנחת עובד", "הנחת נכה", "הנחה כללית"];

export default function Cart({
  items, subtotal, discount, discountAmount, discountValid, total,
  onSetDiscount, onUpdateQty, onUpdatePrice, onRemove, onCheckout,
}) {
  const selectType = (type) => {
    if (discount?.type === type) onSetDiscount(null); // toggle off
    else onSetDiscount({ type, mode: discount?.mode || "percentage", value: discount?.value ?? "" });
  };
  const setMode = (mode) => discount && onSetDiscount({ ...discount, mode });
  const setValue = (value) => discount && onSetDiscount({ ...discount, value });
  return (
    <>
      <div className="p-4 border-b border-slate-700 flex items-center gap-2">
        <ShoppingCart className="w-5 h-5 text-slate-400" />
        <span className="font-semibold">סל הקנייה</span>
        <span className="mr-auto text-slate-400 text-sm">{items.length} פריטים</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-slate-500 text-sm">
            <ShoppingCart className="w-10 h-10 mb-2 opacity-30" />
            <p>הסל ריק</p>
            <p className="text-xs mt-1">לחץ על פעילות להוסיף</p>
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="bg-slate-700 rounded-xl p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm leading-tight flex-1">{item.name}</p>
              <button onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">מחיר/אדם:</span>
              <input
                type="number"
                value={item.customPrice}
                onChange={e => onUpdatePrice(item.id, e.target.value)}
                className="w-20 h-7 bg-slate-600 rounded-lg px-2 text-sm text-center border border-slate-500 focus:outline-none focus:border-primary"
              />
              <span className="text-xs text-slate-400">₪</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdateQty(item.id, -1)}
                  className="w-7 h-7 rounded-lg bg-slate-600 flex items-center justify-center hover:bg-slate-500"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-8 text-center font-bold">{item.qty}</span>
                <button
                  onClick={() => onUpdateQty(item.id, 1)}
                  className="w-7 h-7 rounded-lg bg-slate-600 flex items-center justify-center hover:bg-slate-500"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <span className="font-bold text-emerald-300">{(item.customPrice * item.qty).toLocaleString()}₪</span>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-700 space-y-3">
        {/* Discount controls */}
        {items.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              {DISCOUNT_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => selectType(t)}
                  className={`text-xs py-1.5 rounded-lg border transition-colors ${
                    discount?.type === t
                      ? "bg-amber-500/20 border-amber-500 text-amber-200"
                      : "border-slate-600 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {discount && (
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg overflow-hidden border border-slate-600">
                  <button
                    onClick={() => setMode("percentage")}
                    className={`px-3 py-1.5 text-sm ${discount.mode === "percentage" ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300"}`}
                  >%</button>
                  <button
                    onClick={() => setMode("fixed")}
                    className={`px-3 py-1.5 text-sm ${discount.mode === "fixed" ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300"}`}
                  >₪</button>
                </div>
                <input
                  type="number"
                  value={discount.value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={discount.mode === "percentage" ? "אחוז" : "סכום"}
                  className="flex-1 h-9 bg-slate-700 rounded-lg px-3 text-sm border border-slate-600 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {discount && !discountValid && (
              <p className="text-xs text-rose-400">
                {discount.mode === "percentage" ? "אחוז חייב להיות בין 0 ל-100" : "הנחה לא יכולה לעלות על סכום הסל"}
              </p>
            )}
          </div>
        )}

        {/* Totals */}
        {discount && discountValid && discountAmount > 0 && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span>סכום ביניים</span>
              <span>{subtotal.toLocaleString()}₪</span>
            </div>
            <div className="flex items-center justify-between text-amber-300">
              <span>{discount.type}</span>
              <span>-{discountAmount.toLocaleString()}₪</span>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">סה״כ לתשלום</span>
          <span className="text-2xl font-bold text-emerald-300">{total.toLocaleString()}₪</span>
        </div>
        <Button
          onClick={onCheckout}
          disabled={items.length === 0 || !discountValid}
          className="w-full h-12 text-lg font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl disabled:opacity-40"
        >
          המשך לתשלום →
        </Button>
      </div>
    </>
  );
}