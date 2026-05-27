import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, Trash2, Link2, Link, FileText, Users } from "lucide-react";
import PricingCategory from "@/components/pricing/PricingCategory";
import LinkToLeadQuoteDialog from "@/components/pricing/LinkToLeadQuoteDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function newCategory(name = "") {
  return { id: crypto.randomUUID(), name, rows: [] };
}

const DEFAULT_CATEGORIES = ["מדריך", "ציוד", "לוגיסטיקה", "אוכל", "שונות"];

export default function Pricing() {
  const [sheets, setSheets] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSheets();
  }, []);

  const loadSheets = async () => {
    const { data, error } = await supabase
      .from('pricing_sheets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('pricing_sheets fetch error:', error);
      toast.error('שגיאה בטעינת הגיליונות');
    }
    setSheets(data ?? []);
    setLoading(false);
  };

  const selectSheet = async (id) => {
    const { data, error } = await supabase
      .from('pricing_sheets')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      console.error('pricing_sheet load error:', error);
      toast.error('שגיאה בטעינת הגיליון');
      return;
    }
    setSheet(data);
    setActiveId(id);
  };

  const createNew = async () => {
    const { data: created, error } = await supabase
      .from('pricing_sheets')
      .insert({
        title: "גיליון תמחור חדש",
        categories: DEFAULT_CATEGORIES.map(n => newCategory(n)),
        num_participants: 1,
      })
      .select()
      .single();
    if (error || !created) {
      console.error('pricing_sheet create error:', error);
      toast.error('שגיאה ביצירת הגיליון');
      return;
    }
    setSheets(prev => [created, ...prev]);
    setSheet(created);
    setActiveId(created.id);
  };

  const save = async () => {
    if (!sheet) return;
    setSaving(true);
    try {
      // Recalculate totals
      const totalCost = (sheet.categories || []).flatMap(c => c.rows || []).reduce((s, r) => s + (r.total_cost || 0), 0);
      const totalSell = (sheet.categories || []).flatMap(c => c.rows || []).reduce((s, r) => s + (r.total_sell || 0), 0);
      const totalProfit = totalSell - totalCost;
      const marginPct = totalSell > 0 ? Math.round((totalProfit / totalSell) * 100) : 0;

      // Explicit payload — never spread `sheet` (carries id/created_at/etc.). lead_id/quote_id
      // are UUID FKs that reject "" (handleLink + "נקה קישור" can set ""), so coerce empties to null.
      const payload = {
        title: sheet.title,
        lead_id: sheet.lead_id || null,
        lead_name: sheet.lead_name || null,
        quote_id: sheet.quote_id || null,
        quote_number: sheet.quote_number || null,
        num_participants: sheet.num_participants ?? null,
        categories: sheet.categories || [],
        notes: sheet.notes || null,
        total_cost: totalCost,
        total_sell: totalSell,
        total_profit: totalProfit,
        margin_pct: marginPct,
      };

      const { data: updated, error } = await supabase
        .from('pricing_sheets')
        .update(payload)
        .eq('id', sheet.id)
        .select()
        .single();
      if (error || !updated) {
        console.error('pricing_sheet save error:', error);
        toast.error('שגיאה בשמירת הגיליון');
        return;
      }
      setSheet(updated);
      setSheets(prev => prev.map(s => s.id === updated.id ? updated : s));
      toast.success("נשמר!");
    } finally {
      setSaving(false);
    }
  };

  const deleteSheet = async (id) => {
    const { error } = await supabase.from('pricing_sheets').delete().eq('id', id);
    if (error) {
      console.error('pricing_sheet delete error:', error);
      toast.error('שגיאה במחיקת הגיליון');
      return;
    }
    setSheets(prev => prev.filter(s => s.id !== id));
    if (activeId === id) { setActiveId(null); setSheet(null); }
  };

  const addCategory = () => {
    setSheet(prev => ({ ...prev, categories: [...(prev.categories || []), newCategory()] }));
  };

  const updateCategory = (catId, updated) => {
    setSheet(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? updated : c) }));
  };

  const deleteCategory = (catId) => {
    setSheet(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== catId) }));
  };

  const handleLink = ({ type, id, name, number }) => {
    if (type === "lead") {
      setSheet(prev => ({ ...prev, lead_id: id || "", lead_name: name || "" }));
    } else {
      setSheet(prev => ({ ...prev, quote_id: id || "", quote_number: number || "" }));
    }
    setLinkDialog(false);
  };

  // Totals
  const totalCost = sheet ? (sheet.categories || []).flatMap(c => c.rows || []).reduce((s, r) => s + (r.total_cost || 0), 0) : 0;
  const totalSell = sheet ? (sheet.categories || []).flatMap(c => c.rows || []).reduce((s, r) => s + (r.total_sell || 0), 0) : 0;
  const totalProfit = totalSell - totalCost;
  const marginPct = totalSell > 0 ? Math.round((totalProfit / totalSell) * 100) : 0;
  const perPerson = sheet?.num_participants > 0 ? Math.round(totalSell / sheet.num_participants) : 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0" dir="rtl">
      {/* Sidebar */}
      <div className="w-64 border-l border-border bg-muted/30 flex flex-col shrink-0">
        <div className="p-3 border-b border-border">
          <Button onClick={createNew} className="w-full gap-2" size="sm">
            <Plus className="w-4 h-4" /> גיליון חדש
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <p className="text-xs text-muted-foreground text-center py-4">טוען...</p>}
          {sheets.map(s => (
            <div
              key={s.id}
              onClick={() => selectSheet(s.id)}
              className={cn(
                "flex items-start justify-between gap-1 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors group",
                activeId === s.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.title}</div>
                <div className={cn("text-xs truncate", activeId === s.id ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {s.lead_name && `ליד: ${s.lead_name}`}
                  {s.quote_number && ` | הצעה: ${s.quote_number}`}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); deleteSheet(s.id); }}
                className={cn("opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5", activeId === s.id ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-muted-foreground hover:text-destructive")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!loading && sheets.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">אין גיליונות עדיין</p>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto">
        {!sheet ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <FileText className="w-12 h-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">בחרי גיליון מהרשימה או צרי חדש</p>
            <Button onClick={createNew} className="gap-2"><Plus className="w-4 h-4" /> גיליון חדש</Button>
          </div>
        ) : (
          <div className="p-6 space-y-5 max-w-6xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0 space-y-2">
                <Input
                  value={sheet.title || ""}
                  onChange={e => setSheet(p => ({ ...p, title: e.target.value }))}
                  className="text-xl font-bold border-0 bg-transparent px-0 focus-visible:ring-0 h-auto text-foreground"
                  placeholder="שם הגיליון..."
                />
                <div className="flex items-center gap-3 flex-wrap">
                  {sheet.lead_name && (
                    <Badge variant="outline" className="gap-1 text-xs"><Link className="w-3 h-3" /> ליד: {sheet.lead_name}</Badge>
                  )}
                  {sheet.quote_number && (
                    <Badge variant="outline" className="gap-1 text-xs"><FileText className="w-3 h-3" /> הצעה: {sheet.quote_number}</Badge>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setLinkDialog(true)}>
                    <Link2 className="w-3.5 h-3.5" /> {sheet.lead_id || sheet.quote_id ? "ערוך קישור" : "קשר לליד / הצעה"}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-1.5">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={sheet.num_participants ?? 1}
                    onChange={e => setSheet(p => ({ ...p, num_participants: Number(e.target.value) }))}
                    className="h-7 w-16 text-sm border-0 bg-transparent focus-visible:ring-0 text-center p-0"
                    min={1}
                  />
                  <span className="text-xs text-muted-foreground">משתתפים</span>
                </div>
                <Button onClick={save} disabled={saving} className="gap-2">
                  <Save className="w-4 h-4" /> {saving ? "שומר..." : "שמור"}
                </Button>
              </div>
            </div>

            {/* Summary Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'סה"כ עלות', value: `₪${totalCost.toLocaleString()}`, color: "text-foreground" },
                { label: 'סה"כ מכירה', value: `₪${totalSell.toLocaleString()}`, color: "text-foreground" },
                { label: 'רווח', value: `₪${totalProfit.toLocaleString()} (${marginPct}%)`, color: totalProfit >= 0 ? "text-green-600" : "text-red-500" },
                { label: 'לנפש', value: `₪${perPerson.toLocaleString()}`, color: "text-foreground" },
              ].map(item => (
                <div key={item.label} className="bg-card border border-border rounded-xl px-4 py-3">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className={cn("text-lg font-bold mt-0.5", item.color)}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Categories */}
            <div>
              {(sheet.categories || []).map(cat => (
                <PricingCategory
                  key={cat.id}
                  category={cat}
                  onChange={updated => updateCategory(cat.id, updated)}
                  onDelete={() => deleteCategory(cat.id)}
                  numParticipants={sheet.num_participants}
                />
              ))}
              <Button variant="outline" className="gap-2 mt-2" onClick={addCategory}>
                <Plus className="w-4 h-4" /> הוסף קטגוריה
              </Button>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">הערות</label>
              <textarea
                value={sheet.notes || ""}
                onChange={e => setSheet(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-border bg-background text-sm px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="הערות כלליות לגיליון..."
              />
            </div>
          </div>
        )}
      </div>

      <LinkToLeadQuoteDialog
        open={linkDialog}
        onClose={() => setLinkDialog(false)}
        onLink={handleLink}
        currentLeadId={sheet?.lead_id}
        currentQuoteId={sheet?.quote_id}
      />
    </div>
  );
}