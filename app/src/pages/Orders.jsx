import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Mail, FileText } from "lucide-react";
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

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
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
      ] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('activities').select('*'),
        supabase.from('instructors').select('*'),
      ]);

      if (eO) console.error('orders error:', eO);
      if (eA) console.error('activities error:', eA);
      if (eI) console.error('instructors error:', eI);

      setOrders(o ?? []);
      setActivities(a ?? []);
      setInstructors(ins ?? []);
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

  const filtered = orders.filter(o => {
    const matchSearch = !search || 
      o.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.organization?.toLowerCase().includes(search.toLowerCase()) ||
      o.order_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleDelete = async () => {
    const { error } = await supabase.from('orders').delete().eq('id', deleteId);
    if (error) console.error('delete error:', error);
    setDeleteId(null);
    loadData();
  };

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
          <h1 className="text-3xl font-bold tracking-tight">הזמנות</h1>
          <p className="text-muted-foreground mt-1">{orders.length} הזמנות סה״כ</p>
        </div>
        <Button onClick={() => { setEditingOrder(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> הזמנה חדשה
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="חיפוש לפי שם, ארגון, מספר הזמנה..." value={search} onChange={e => setSearch(e.target.value)} className="pr-10" />
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

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
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
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{order.order_number || "—"}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">{order.client_name}</p>
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
    </div>
  );
}