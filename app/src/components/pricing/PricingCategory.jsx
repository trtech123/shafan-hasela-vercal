import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import PricingRow from "./PricingRow";
import { useState } from "react";
import { cn } from "@/lib/utils";

function newRow() {
  return { id: crypto.randomUUID(), description: "", quantity: 1, cost: "", sell_price: "", total_cost: 0, total_sell: 0, profit: 0, margin_pct: 0, notes: "" };
}

export default function PricingCategory({ category, onChange, onDelete, numParticipants }) {
  const [collapsed, setCollapsed] = useState(false);

  const updateRow = (rowId, updated) => {
    onChange({ ...category, rows: category.rows.map(r => r.id === rowId ? updated : r) });
  };

  const deleteRow = (rowId) => {
    onChange({ ...category, rows: category.rows.filter(r => r.id !== rowId) });
  };

  const addRow = () => {
    onChange({ ...category, rows: [...(category.rows || []), newRow()] });
  };

  const catTotalCost = (category.rows || []).reduce((s, r) => s + (r.total_cost || 0), 0);
  const catTotalSell = (category.rows || []).reduce((s, r) => s + (r.total_sell || 0), 0);
  const catProfit = catTotalSell - catTotalCost;
  const catMargin = catTotalSell > 0 ? Math.round((catProfit / catTotalSell) * 100) : 0;

  return (
    <div className="border border-border rounded-xl overflow-hidden mb-4">
      {/* Category Header */}
      <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5 gap-3">
        <button onClick={() => setCollapsed(!collapsed)} className="text-muted-foreground hover:text-foreground">
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <Input
          value={category.name}
          onChange={e => onChange({ ...category, name: e.target.value })}
          placeholder="שם קטגוריה..."
          className="h-8 font-semibold text-sm flex-1 border-0 bg-transparent focus-visible:ring-1"
        />
        <div className="flex items-center gap-4 text-xs text-muted-foreground whitespace-nowrap">
          <span>עלות: <strong className="text-foreground">₪{catTotalCost.toLocaleString()}</strong></span>
          <span>מכירה: <strong className="text-foreground">₪{catTotalSell.toLocaleString()}</strong></span>
          <span className={cn("font-semibold", catProfit >= 0 ? "text-green-600" : "text-red-500")}>
            רווח: ₪{catProfit.toLocaleString()} ({catMargin}%)
          </span>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {!collapsed && (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20 text-xs text-muted-foreground">
                <th className="text-right px-3 py-2 font-medium min-w-[200px]">תיאור</th>
                <th className="text-center px-3 py-2 font-medium w-24">כמות</th>
                <th className="text-left px-3 py-2 font-medium w-36">עלות ליחידה ₪</th>
                <th className="text-left px-3 py-2 font-medium w-36">סה"כ עלות</th>
                <th className="text-left px-3 py-2 font-medium w-36">מחיר מכירה ₪</th>
                <th className="text-left px-3 py-2 font-medium w-36">סה"כ מכירה</th>
                <th className="text-left px-3 py-2 font-medium w-36">רווח ₪</th>
                <th className="text-left px-3 py-2 font-medium w-24">% רווח</th>
                <th className="text-right px-3 py-2 font-medium w-44">הערות</th>
                <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(category.rows || []).map(row => (
                  <PricingRow
                    key={row.id}
                    row={row}
                    onChange={updated => updateRow(row.id, updated)}
                    onDelete={() => deleteRow(row.id)}
                    numParticipants={numParticipants}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-border/40">
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={addRow}>
              <Plus className="w-3.5 h-3.5" /> הוסף שורה
            </Button>
          </div>
        </>
      )}
    </div>
  );
}