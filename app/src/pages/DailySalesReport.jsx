import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import moment from "moment";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, ShoppingBag, CreditCard, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const METHOD_COLORS = {
  "מזומן":      "bg-emerald-100 text-emerald-800",
  "אשראי":      "bg-blue-100 text-blue-800",
  "העברה":      "bg-purple-100 text-purple-800",
  "אפליקציה":   "bg-orange-100 text-orange-800",
  "חשבונית":   "bg-slate-100 text-slate-800",
};

export default function DailySalesReport() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .order('sale_date', { ascending: false })
        .limit(500);
      if (error) {
        console.error('sales fetch error:', error);
        toast.error('שגיאה בטעינת המכירות');
      }
      setSales(data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const weekStart = useMemo(() =>
    moment().add(weekOffset, "weeks").startOf("isoWeek"), [weekOffset]
  );
  const weekEnd = useMemo(() =>
    moment().add(weekOffset, "weeks").endOf("isoWeek"), [weekOffset]
  );

  const weekSales = useMemo(() =>
    sales.filter(s => {
      const d = moment(s.sale_date);
      return d.isSameOrAfter(weekStart, "day") && d.isSameOrBefore(weekEnd, "day");
    }), [sales, weekStart, weekEnd]
  );

  const dailyData = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = weekStart.clone().add(i, "days");
      const key = day.format("YYYY-MM-DD");
      const daySales = weekSales.filter(s => s.sale_date === key);
      days.push({
        label: day.format("ddd DD/MM"),
        date: key,
        revenue: daySales.reduce((s, x) => s + (x.total || 0), 0),
        count: daySales.length,
        sales: daySales,
      });
    }
    return days;
  }, [weekSales, weekStart]);

  const weekTotal = weekSales.reduce((s, x) => s + (x.total || 0), 0);
  const weekCount = weekSales.length;

  const methodBreakdown = useMemo(() => {
    const map = {};
    weekSales.forEach(s => {
      map[s.method] = (map[s.method] || 0) + s.total;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [weekSales]);

  const [selectedDay, setSelectedDay] = useState(null);
  const selectedDayData = selectedDay ? dailyData.find(d => d.date === selectedDay) : null;

  const exportToExcel = () => {
    const weekLabel = `${weekStart.format("DD-MM-YYYY")}_${weekEnd.format("DD-MM-YYYY")}`;

    // BOM for Hebrew support in Excel
    const BOM = "\uFEFF";

    // Sheet 1: daily summary
    const summaryRows = [
      ["יום", "תאריך", "מספר מכירות", "הכנסה (₪)"],
      ...dailyData.map(d => [d.label, d.date, d.count, d.revenue]),
      [],
      ["סה\"כ", "", weekCount, weekTotal],
    ];

    // Sheet 2: all sales detail
    const detailRows = [
      ["תאריך", "מספר קבלה", "אמצעי תשלום", "סכום (₪)", "פריטים"],
      ...weekSales.map(s => [
        s.sale_date,
        s.receipt_number || "",
        s.method || "",
        s.total,
        (s.items || []).map(i => `${i.name} x${i.qty}`).join(" | "),
      ]),
    ];

    // Sheet 3: method breakdown
    const methodRows = [
      ["אמצעי תשלום", "סכום כולל (₪)"],
      ...methodBreakdown.map(([method, amount]) => [method, amount]),
    ];

    const toCSV = rows => rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

    // Combine into one CSV with section headers
    const csv = BOM +
      "=== סיכום יומי ===\n" + toCSV(summaryRows) +
      "\n\n=== פירוט מכירות ===\n" + toCSV(detailRows) +
      "\n\n=== לפי אמצעי תשלום ===\n" + toCSV(methodRows);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `דוח_קופה_${weekLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">דוח סיכום יומי — קופה</h1>
          <p className="text-muted-foreground mt-1">מעקב הכנסות ומכירות יומיות</p>
        </div>
        <Button variant="outline" onClick={exportToExcel} className="gap-2">
          <Download className="w-4 h-4" />
          ייצוא לאקסל
        </Button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-card rounded-2xl border border-border p-4">
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w - 1)}>
          <ChevronRight className="w-5 h-5" />
        </Button>
        <div className="text-center">
          <p className="font-bold">{weekStart.format("DD/MM/YYYY")} – {weekEnd.format("DD/MM/YYYY")}</p>
          <p className="text-sm text-muted-foreground">
            {weekOffset === 0 ? "השבוע" : weekOffset === -1 ? "שבוע שעבר" : `לפני ${Math.abs(weekOffset)} שבועות`}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 0}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-2xl border border-border p-5 space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <TrendingUp className="w-5 h-5" />
            <span className="text-sm font-medium text-muted-foreground">הכנסה שבועית</span>
          </div>
          <p className="text-3xl font-bold">{weekTotal.toLocaleString()}₪</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5 space-y-1">
          <div className="flex items-center gap-2 text-secondary">
            <ShoppingBag className="w-5 h-5" />
            <span className="text-sm font-medium text-muted-foreground">מכירות בשבוע</span>
          </div>
          <p className="text-3xl font-bold">{weekCount}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5 space-y-1 col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CreditCard className="w-5 h-5" />
            <span className="text-sm font-medium">ממוצע למכירה</span>
          </div>
          <p className="text-3xl font-bold">{weekCount ? Math.round(weekTotal / weekCount).toLocaleString() : 0}₪</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h2 className="font-semibold mb-4">הכנסות לפי יום</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyData} barSize={36} onClick={d => d?.activePayload && setSelectedDay(d.activePayload[0]?.payload?.date)}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}₪`} />
            <Tooltip
              formatter={(value) => [`${value.toLocaleString()}₪`, "הכנסה"]}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontFamily: "Heebo, sans-serif" }}
              cursor={{ fill: "hsl(var(--muted))" }}
            />
            <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Daily breakdown table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">סיכום יומי</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-right p-3 text-muted-foreground font-medium">יום</th>
                <th className="text-center p-3 text-muted-foreground font-medium">מכירות</th>
                <th className="text-left p-3 text-muted-foreground font-medium">הכנסה</th>
              </tr>
            </thead>
            <tbody>
              {dailyData.map(day => (
                <tr
                  key={day.date}
                  onClick={() => setSelectedDay(selectedDay === day.date ? null : day.date)}
                  className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/50 ${selectedDay === day.date ? "bg-muted" : ""}`}
                >
                  <td className="p-3 font-medium">{day.label}</td>
                  <td className="p-3 text-center">
                    {day.count > 0
                      ? <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded-full">{day.count}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3 text-left font-bold">{day.revenue > 0 ? `${day.revenue.toLocaleString()}₪` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Method breakdown or selected day detail */}
        {selectedDayData ? (
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">מכירות — {moment(selectedDayData.date).format("DD/MM/YYYY")}</h2>
              <button onClick={() => setSelectedDay(null)} className="text-xs text-muted-foreground hover:text-foreground">סגור ✕</button>
            </div>
            <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
              {selectedDayData.sales.length === 0 && (
                <p className="text-center text-muted-foreground text-sm p-6">אין מכירות ביום זה</p>
              )}
              {selectedDayData.sales.map(sale => (
                <div key={sale.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{sale.receipt_number}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${METHOD_COLORS[sale.method] || "bg-muted text-muted-foreground"}`}>{sale.method}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{(sale.items || []).map(i => i.name).join(", ")}</span>
                    <span className="font-bold">{sale.total.toLocaleString()}₪</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold">פירוט לפי אמצעי תשלום</h2>
            </div>
            <div className="p-4 space-y-3">
              {methodBreakdown.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-8">אין נתונים לשבוע זה</p>
              )}
              {methodBreakdown.map(([method, amount]) => (
                <div key={method} className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full min-w-20 text-center ${METHOD_COLORS[method] || "bg-muted text-muted-foreground"}`}>{method}</span>
                  <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${weekTotal ? (amount / weekTotal) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="font-bold text-sm min-w-20 text-left">{amount.toLocaleString()}₪</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}