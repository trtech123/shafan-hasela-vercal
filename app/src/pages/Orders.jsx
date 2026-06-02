import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Mail, FileText, CheckCircle2, Link2 } from "lucide-react";
import InstructorEmailDialog from "../components/orders/InstructorEmailDialog";
import OrderDocumentDialog from "../components/orders/OrderDocumentDialog";
import OrderStatusBadge from "../components/orders/OrderStatusBadge";
import PaymentBadge from "../components/orders/PaymentBadge";
import OrderFormDialog from "../components/orders/OrderFormDialog";
import moment from "moment";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SITES = ["עכו", "טבריה", "נוף הגליל", "שטח"];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [quotes, setQuotes] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [emailOrder, setEmailOrder] = useState(null);
  const [docOrder, setDocOrder] = useState(null);

  const loadData = async () => {
    try {
      const [
        { data: o, error: eO },
        { data: a, error: eA },
        { data: ins, error: eI },
        { data: q, error: eQ },
      ] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('activities').select('*'),
        supabase.from('instructors').select('*'),
        supabase.from('quotes').select('id, quote_number, client_name, event_date').order('created_at', { ascending: false }).limit(200),
      ]);

      if (eO) console.error('orders error:', eO);
      if (eA) console.error('activities error:', eA);
      if (eI) console.error('instructors error:', eI);
      if (eQ) console.error('quotes error:', eQ);

      setOrders(o ?? []);
      setActivities(a ?? []);
      setInstructors(ins ?? []);
      setQuotes(q ?? []);
    } catch (err) {
      console.error('Orders loadData error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const getActivityName = (activityId) => {
    const act = activities.find(a => a.id === activityId);
    return act?.name || "—";
  };

  const activityById = useMemo(
    () => Object.fromEntries(activities.map(a => [a.id, a])),
    [activities]
  );

  const quoteById = useMemo(
    () => Object.fromEntries(quotes.map(q => [q.id, q])),
    [quotes]
  );

  const categoryOptions = useMemo(() => {
    const set = new Set(activities.map(a => a.category).filter(Boolean));
    return Array.from(set).sort();
  }, [activities]);

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      o.client_name?.toLowerCase().includes(q) ||
      o.organization?.toLowerCase().includes(q) ||
      o.order_number?.toLowerCase().includes(q) ||
      o.notes?.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    const matchSite = siteFilter === "all" || o.site === siteFilter;
    const orderCategory = activityById[o.activity_id]?.category;
    const matchCategory = categoryFilter === "all" || orderCategory === categoryFilter;
    return matchSearch && matchStatus && matchSite && matchCategory;
  });

  const handleDelete = async () => {
    const { error } = await supabase.from('orders').delete().eq('id', deleteId);
    if (error) console.error('delete error:', error);
    setDeleteId(null);
    loadData();
  };

  const markNotified = async (orderId) => {
    const { error } = await supabase
      .from('orders')
      .update({ instructor_notified: true })
      .eq('id', orderId);
    if (error) {
      console.error('mark notified error:', error);
      return;
    }
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, instructor_notified: true } : o));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 sm:pb-0" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">הזמנות</h1>
          <p className="text-muted-foreground mt-1">{orders.length} הזמנות סה״כ</p>
        </div>
        <Button onClick={() => { setEditingOrder(null); setDialogOpen(true); }} className="gap-2 hidden sm:inline-flex">
          <Plus className="w-4 h-4" /> הזמנה חדשה
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="חיפוש לפי שם, ארגון, מספר הזמנה, הערות..." value={search} onChange={e => setSearch(e.target.value)} className="pr-10" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              {["ממתין לאישור","מאושר","שולם","בוצע","בוטל"].map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">אתר:</span>
          <button
            type="button"
            onClick={() => setSiteFilter("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              siteFilter === "all"
                ? "bg-slate-100 text-slate-700 border-slate-300 shadow-sm"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            }`}
          >הכל</button>
          {SITES.map(site => (
            <button
              key={site}
              type="button"
              onClick={() => setSiteFilter(site)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                siteFilter === site
                  ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              }`}
            >{site}</button>
          ))}
        </div>

        {categoryOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">סוג פעילות:</span>
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                categoryFilter === "all"
                  ? "bg-slate-100 text-slate-700 border-slate-300 shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              }`}
            >הכל</button>
            {categoryOptions.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  categoryFilter === c
                    ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >{c}</button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile card list (<md). Table layout below cannot fit phone widths without horizontal-scroll clipping. */}
      <div className="md:hidden bg-card rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">לא נמצאו הזמנות</div>
        ) : (
          filtered.map(order => (
            <div key={order.id} className="p-4 space-y-2 hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[11px] text-muted-foreground font-mono">{order.order_number || "—"}</span>
                  {order.quote_id && quoteById[order.quote_id] && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-0.5 w-fit">
                      <Link2 className="w-2.5 h-2.5" />
                      {quoteById[order.quote_id].quote_number}
                    </span>
                  )}
                </div>
                <OrderStatusBadge status={order.status} />
              </div>

              <div>
                <p className="font-semibold text-sm flex items-center gap-1.5">
                  <span className="truncate">{order.client_name}</span>
                  {order.instructor_notified && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" title="המדריך עודכן" />
                  )}
                </p>
                {order.organization && <p className="text-xs text-muted-foreground truncate">{order.organization}</p>}
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>🏔️ {getActivityName(order.activity_id)}</span>
                <span>📅 {order.activity_date ? moment(order.activity_date).format("DD/MM/YY") : "—"}</span>
                {order.num_participants ? <span>👥 {order.num_participants}</span> : null}
                {order.total_price ? <span className="font-medium text-foreground">₪{order.total_price.toLocaleString()}</span> : null}
              </div>

              <div className="flex items-center justify-between pt-1">
                <PaymentBadge status={order.payment_status} />
                <div className="flex gap-0.5">
                  <button onClick={() => { setEditingOrder(order); setDialogOpen(true); }} className="p-2 hover:bg-muted rounded-lg transition-colors">
                    <Pencil className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => setDocOrder(order)} className="p-2 hover:bg-primary/10 rounded-lg transition-colors" title="מסמך ללקוח">
                    <FileText className="w-4 h-4 text-primary" />
                  </button>
                  {order.instructor_id && (
                    <button onClick={() => setEmailOrder(order)} className="p-2 hover:bg-blue-50 rounded-lg transition-colors" title="שלח מייל למדריך">
                      <Mail className="w-4 h-4 text-blue-400" />
                    </button>
                  )}
                  <button onClick={() => setDeleteId(order.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Tablet/desktop table (md+) */}
      <div className="hidden md:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-muted-foreground">
                <th className="text-right font-medium px-4 py-3">מס׳</th>
                <th className="text-right font-medium px-4 py-3">לקוח</th>
                <th className="text-right font-medium px-4 py-3 hidden md:table-cell">פעילות</th>
                <th className="text-right font-medium px-4 py-3">תאריך</th>
                <th className="text-right font-medium px-4 py-3 hidden sm:table-cell">משתתפים</th>
                <th className="text-right font-medium px-4 py-3">סטטוס</th>
                <th className="text-right font-medium px-4 py-3 hidden lg:table-cell">תשלום</th>
                <th className="text-right font-medium px-4 py-3 hidden lg:table-cell">סכום</th>
                <th className="text-right font-medium px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">לא נמצאו הזמנות</td></tr>
              ) : (
                filtered.map(order => (
                  <tr key={order.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      <div className="flex flex-col gap-0.5">
                        <span>{order.order_number || "—"}</span>
                        {order.quote_id && quoteById[order.quote_id] && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-0.5 w-fit">
                            <Link2 className="w-2.5 h-2.5" />
                            {quoteById[order.quote_id].quote_number}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium flex items-center gap-1.5">
                          {order.client_name}
                          {order.instructor_notified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" title="המדריך עודכן" />
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.organization || ""}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">{getActivityName(order.activity_id)}</td>
                    <td className="px-4 py-3">{order.activity_date ? moment(order.activity_date).format("DD/MM/YY") : "—"}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">{order.num_participants || "—"}</td>
                    <td className="px-4 py-3"><OrderStatusBadge status={order.status} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell"><PaymentBadge status={order.payment_status} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell font-medium">₪{(order.total_price || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingOrder(order); setDialogOpen(true); }} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button onClick={() => setDocOrder(order)} className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors" title="מסמך ללקוח">
                          <FileText className="w-4 h-4 text-primary" />
                        </button>
                        {order.instructor_id && (
                          <button onClick={() => setEmailOrder(order)} className="p-1.5 hover:bg-blue-50 rounded-lg transition-colors" title="שלח מייל למדריך">
                            <Mail className="w-4 h-4 text-blue-400" />
                          </button>
                        )}
                        <button onClick={() => setDeleteId(order.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OrderFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} order={editingOrder} activities={activities} onSaved={loadData} />

      <InstructorEmailDialog
        open={!!emailOrder}
        onClose={() => setEmailOrder(null)}
        order={emailOrder}
        instructor={instructors.find(i => i.id === emailOrder?.instructor_id)}
        activity={activities.find(a => a.id === emailOrder?.activity_id)}
        onNotified={() => emailOrder && markNotified(emailOrder.id)}
      />

      <OrderDocumentDialog
        open={!!docOrder}
        onClose={() => setDocOrder(null)}
        order={docOrder}
        activity={activities.find(a => a.id === docOrder?.activity_id)}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הזמנה</AlertDialogTitle>
            <AlertDialogDescription>האם את בטוחה שברצונך למחוק את ההזמנה? פעולה זו בלתי הפיכה.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        className="fixed bottom-0 inset-x-0 z-30 sm:hidden bg-gradient-to-t from-background via-background/95 to-background/70 backdrop-blur-sm border-t border-border p-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <Button onClick={() => { setEditingOrder(null); setDialogOpen(true); }} className="w-full gap-2 shadow-lg">
          <Plus className="w-4 h-4" /> הזמנה חדשה
        </Button>
      </div>
    </div>
  );
}