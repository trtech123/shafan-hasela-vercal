import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PricingRow({ row, onChange, onDelete, numParticipants }) {
  const handleChange = (field, value) => {
    const updated = { ...row, [field]: value === "" ? "" : Number(value) || value };

    // Auto-calc total_cost
    const qty = field === "quantity" ? Number(value) : (Number(updated.quantity) || 1);
    const cost = field === "cost" ? Number(value) : (Number(updated.cost) || 0);
    updated.total_cost = cost * qty;

    // Auto-calc total_sell
    const sell = field === "sell_price" ? Number(value) : (Number(updated.sell_price) || 0);
    updated.total_sell = sell * qty;

    // Auto-calc profit & margin
    updated.profit = updated.total_sell - updated.total_cost;
    updated.margin_pct = updated.total_sell > 0
      ? Math.round((updated.profit / updated.total_sell) * 100)
      : 0;

    if (field === "description" || field === "notes") {
      updated[field] = value;
    }

    onChange(updated);
  };

  const profitColor = row.profit > 0 ? "text-green-600" : row.profit < 0 ? "text-red-500" : "text-muted-foreground";

  return (
    <tr className="border-b border-border/40 hover:bg-muted/20 transition-colors group">
      <td className="px-3 py-2 min-w-[200px]">
        <Input
          value={row.description || ""}
          onChange={e => handleChange("description", e.target.value)}
          placeholder="תיאור..."
          className="h-9 text-sm"
        />
      </td>
      <td className="px-3 py-2 w-24">
        <Input
          type="number"
          value={row.quantity ?? 1}
          onChange={e => handleChange("quantity", e.target.value)}
          className="h-9 text-sm text-center"
          min={0}
        />
      </td>
      <td className="px-3 py-2 w-36">
        <Input
          type="number"
          value={row.cost ?? ""}
          onChange={e => handleChange("cost", e.target.value)}
          placeholder="0"
          className="h-9 text-sm"
        />
      </td>
      <td className="px-3 py-2 w-36 text-sm text-muted-foreground font-medium">
        ₪{((row.total_cost) || 0).toLocaleString()}
      </td>
      <td className="px-3 py-2 w-36">
        <Input
          type="number"
          value={row.sell_price ?? ""}
          onChange={e => handleChange("sell_price", e.target.value)}
          placeholder="0"
          className="h-9 text-sm"
        />
      </td>
      <td className="px-3 py-2 w-36 text-sm text-muted-foreground font-medium">
        ₪{((row.total_sell) || 0).toLocaleString()}
      </td>
      <td className={cn("px-3 py-2 w-36 text-sm font-semibold", profitColor)}>
        ₪{((row.profit) || 0).toLocaleString()}
      </td>
      <td className={cn("px-3 py-2 w-24 text-sm font-medium", profitColor)}>
        {row.margin_pct ?? 0}%
      </td>
      <td className="px-3 py-2 w-44">
        <Input
          value={row.notes || ""}
          onChange={e => handleChange("notes", e.target.value)}
          placeholder="הערה..."
          className="h-9 text-sm"
        />
      </td>
      <td className="px-3 py-2 w-10">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </td>
    </tr>
  );
}