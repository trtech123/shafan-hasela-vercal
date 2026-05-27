import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, FileText, Eye, CheckCircle2, Trash2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import moment from "moment";
import QuoteFormDialog from "../components/quotes/QuoteFormDialog";
import QuotePDFDocument from "../components/quotes/QuotePDFDocument";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const STATUS_STYLES = {
  "טיוטה":           "bg-slate-100 text-slate-600 border-slate-200",
  "נשלחה":           "bg-blue-50 text-blue-700 border-blue-200",
  "ממתינה לאישור":   "bg-amber-50 text-amber-700 border-amber-200",
  "אושרה":           "bg-emerald-50 text-emerald-700 border-emerald-200",
  "בוטלה":           "bg-red-50 text-red-600 border-red-200",
};

export default function Quotes() {
  const [quotes, setQuotes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [pdfQuote, setPdfQuote] = useState(null);
  const [pdfMode, setPdfMode] = useState("quote");
  const [deleteId, setDeleteId] = useState(null);
  const [converting, setConverting] = useState(null);

  const load = async () => {
    try {
      const [
        { data: quotesData, error: eQ },
        { data: activitiesData, error: eA },
      ] = await Promise.all([
        supabase.from('quotes').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('activities').select('*'),
      ]);
      if (eQ) console.error('quotes fetch error:', eQ);
      if (eA) console.error('activities fetch error:', eA);
      setQuotes(quotesData ?? []);
      setActivities(activitiesData ?? []);
    } catch (err) {
      console.error('Quotes load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Enriches selected_activities JSONB with images/description from the activities list
  const enrichQuote = (quote) => ({
    ...quote,
    selected_activities: (quote.selected_activities || []).map(sa => {
      const found = activities.find(a => a.id === sa.activity_id);
      return {
        ...sa,
        images: (sa.images && sa.images.length > 0) ? sa.images : (found?.images || []),
        image_url: sa.image_url || found?.image_url || "",
        description: sa.description || found?.description || "",
      };
    }),
  });

  const handleDelete = async () => {
    const { error } = await supabase.from('quotes').delete().eq('id', deleteId);
    if (error) { console.error('delete quote error:', error); toast.error('שגיאה במחיקה'); }
    setDeleteId(null);
    load();
  };

  const handleConvertToOrder = async (quote) => {
    setConverting(quote.id);
    try {
      // Use first selected activity's ID if available
      const firstActivityId = quote.selected_activities?.[0]?.activity_id || null;

      const { data: order, error: eCreate } = await supabase
        .from('orders')
        .insert({
          client_name:      quote.client_name,
          client_phone:     quote.client_phone,
          client_email:     quote.client_email,
          organization:     quote.organization,
          activity_id:      firstActivityId,
          activity_date:    quote.event_date || new Date().toISOString().split('T')[0],
          site:             quote.site,
          num_participants: quote.num_participants || 1,
          total_price:      quote.final_price,
          notes:            quote.notes,
          status:           "מאושר",
          payment_status:   "לא שולם",
          quote_id:         quote.id,
        })
        .select()
        .single();

      if (eCreate) { console.error('create order error:', eCreate); toast.error('שגיאה ביצירת הזמנה'); return; }

      const { error: eUpdate } = await supabase
        .from('quotes')
        .update({ status: "אושרה", converted_to_order_id: order.id })
        .eq('id', quote.id);

      if (eUpdate) console.error('update quote error:', eUpdate);

      await load();
      // Show confirmation PDF with the DB-generated order number
      setPdfQuote(enrichQuote({ ...quote, order_number: order.order_number, status: "אושרה" }));
      setPdfMode("order");
      toast.success('הצעה הומרה להזמנה בהצלחה');
    } catch (err) {
      console.error('handleConvertToOrder error:', err);
      toast.error('שגיאה בהמרה להזמנה');
    } finally {
      setConverting(null);
    }
  };

  const filtered = quotes.filter(q =>
    q.client_name?.includes(search) ||
    q.organization?.includes(search) ||
    q.quote_number?.includes(search)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">הצעות מחיר</h1>
          <p className="text-muted-foreground mt-1">ניהול הצעות מחיר ללקוחות</p>
        </div>
        <Button onClick={() => { setEditingQuote(null); setDialogOpen(true); }} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="w-4 h-4" /> הצעה חדשה
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="חיפוש לפי שם, ארגון..."
          className="pr-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-12 text-center">
          <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-muted-foreground mb-4">עדיין אין הצעות מחיר</p>
          <Button onClick={() => { setEditingQuote(null); setDialogOpen(true); }} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4" /> הצעה ראשונה
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(quote => (
            <div key={quote.id} className="bg-card rounded-2xl border border-border shadow-sm p-5 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <span className="text-xs font-mono text-muted-foreground">{quote.quote_number}</span>
                    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", STATUS_STYLES[quote.status] || "bg-muted text-muted-foreground border-border")}>
                      {quote.status}
                    </span>
                  </div>
                  <h3 className="font-bold text-lg leading-tight">{quote.client_name}</h3>
                  {quote.organization && <p className="text-sm text-muted-foreground">{quote.organization}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                    {quote.event_date && <span>📅 {moment(quote.event_date).format("DD/MM/YYYY")}</span>}
                    {quote.site && <span>📍 {quote.site}</span>}
                    {quote.num_participants && <span>👥 {quote.num_participants} משתתפים</span>}
                    <span>🏷 {(quote.selected_activities || []).length} פעילויות</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-left">
                    <p className="text-2xl font-bold text-primary">{(quote.final_price || 0).toLocaleString()}₪</p>
                    {quote.discount > 0 && <p className="text-xs text-muted-foreground">הנחה: {quote.discount.toLocaleString()}₪</p>}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { setPdfQuote(enrichQuote(quote)); setPdfMode("quote"); }}>
                  <Eye className="w-3.5 h-3.5" /> צפה / שלח
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { setEditingQuote(quote); setDialogOpen(true); }}>
                  עריכה
                </Button>
                {!quote.converted_to_order_id && quote.status !== "בוטלה" && (
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleConvertToOrder(quote)}
                    disabled={converting === quote.id}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {converting === quote.id ? "ממיר..." : "הפוך להזמנה"}
                  </Button>
                )}
                {quote.converted_to_order_id && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> הומר להזמנה
                  </span>
                )}
                <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 mr-auto" onClick={() => setDeleteId(quote.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <QuoteFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        quote={editingQuote}
        onSaved={load}
      />

      {pdfQuote && (
        <QuotePDFDocument
          quote={pdfQuote}
          mode={pdfMode}
          onClose={() => setPdfQuote(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הצעת מחיר</AlertDialogTitle>
            <AlertDialogDescription>האם אתה בטוח? פעולה זו בלתי הפיכה.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
