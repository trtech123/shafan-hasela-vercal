import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Cart({ items, total, onUpdateQty, onUpdatePrice, onRemove, onCheckout }) {
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
        <div className="flex items-center justify-between">
          <span className="text-slate-400">סה״כ לתשלום</span>
          <span className="text-2xl font-bold text-emerald-300">{total.toLocaleString()}₪</span>
        </div>
        <Button
          onClick={onCheckout}
          disabled={items.length === 0}
          className="w-full h-12 text-lg font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl disabled:opacity-40"
        >
          המשך לתשלום →
        </Button>
      </div>
    </>
  );
}